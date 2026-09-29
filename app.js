const winston = require('winston');
require('winston-syslog');
const express = require('express');
const path = require('path');
const mqtt = require('async-mqtt');
const cors = require('cors');
const app = express();
const fs = require('fs');
const PORT = 3000;
const SERVER_URL = 'mqtt://drmatthewclark.com:1883'; // mqtt broker
const saved_data = '/var/www/telegram-saved.txt';    // remembers content between restarts
const local_name_file = '/usr/local/rpi_telegraph/local_name'  // storing the topic name for this device
const local_name = fs.readFileSync(local_name_file, 'utf8').trim();  // local name for specific topic
const qos = 0;  // mqtt qos
const password = local_name + '-t7f+&0mE9wg,_?D';  // mosquitto password
const wordspace_timing = 3000  // delay to make a word space using telegraph key

var counter = 0;
var telegram =  fs.readFileSync(saved_data, 'utf8').trim();       // accumulated message 
var newdataflag = false;
var timestampinterval = 30 * 1000; // interval between stamps millisecs
var lasttimestamp = 0; // set so it has expired
var global_res = false;

app.use(express.urlencoded({ extended: true })); 
app.use(express.static(path.join(__dirname, '.')));
app.use(cors());
   

const logger = winston.createLogger({
  level: 'info', // Set default logging level
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    }),
    new winston.transports.Syslog({
      protocol: 'unix',   // use 'tcp' or 'udp'
      path: '/dev/log',  // for local logging on Unix-based systems
      app_name: 'telegraph-app.js', // application name for log identification
      format: winston.format.printf(info => `${info.message}`) // simple message format
    })
  ]
});

var server_client = mqtt.connect(SERVER_URL, {username: local_name, password: password, clientId: local_name + 'web'  } );
server_client.on("connect", function() { logger.info(" mqtt connected :" + server_client.connected ) } );
server_client.on("error",function(error){ console.log("Can't connect "+error)});

// make a SSE mesage from the data
function makemsg( msg ) {
   save();
   return "data: " + msg  + "\n\n";
};


function timestamp() {
    var now = new Date();
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    hrs = ("0" + (now.getHours() )).slice(-2); 
    mins = ("0" + (now.getMinutes() )).slice(-2) ;
    var result = hrs + ":" + mins  + "GMT" + now.getTimezoneOffset() ; //+ tz; offset in minutes
    return result.trim() + " ";
}

function check() {
     let now = new Date();
     if ( (now - lasttimestamp) > timestampinterval ) {
        logger.info('adding timestamp ' + timestamp() );
        telegram += ' AA ' + timestamp(); // AA is newline prosign
        lasttimestamp = now;
     }
};

app.get('/events', function(req, res) {


   res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive'
    });

    function update() {
       finalmsg = makemsg( telegram );
       logger.info("app2 open update client " + counter );
       res.write(finalmsg);
       newdataflag = false;
    }

    update();

    const resloop = () => {
      if (newdataflag) {
        counter = counter + 1
        if (telegram != '' ) {
             check();
             update();
          }
        }
      }

      const interval = setInterval( resloop, 1500 );
     
     // Handle client disconnection
     req.on('close', () => {
        logger.info('req.on closed received');
        clearInterval(interval);
        res.end();
     });

     if (telegram.trim() !== "") {
        logger.info( "app2.get loop end" );
     }
});



async function waitForMessage(client, topic) {
  return new Promise((resolve) => {
    const messageHandler = (t, message) => {
      logger.info('waitForMessage', t, message );
      if (topic.includes(t)) {
        resolve(message.toString());
        client.off('message', messageHandler); // listener is off
      }
    };
    // Attach the handler
    client.on('message', messageHandler); // listener is on
  });
}



async function run_t() {

  const subscription  = ['telegraph', 'telegraph/' + local_name,  'interpret' ];
  const client = server_client;
  await client.subscribe(subscription, 0);
  lastletter = 0;
 
  logger.info('run_t function subscribed to ' + SERVER_URL + ' ' + subscription.join(',') + '  and waiting for message...');

  // loop for listening for messages
  while (true) {
     var message = await waitForMessage(client, subscription);
     console.log( 'run_t received message: >' +  message + '<' );
     logger.info('run_t received message: >' +  message + '<');
     if (message != '') {
        check();
        now = Date();
        if ((now - lastletter) > wordspace_timing) {  // space between words time in milliseconds add word space
            message = " " + message;
            logger.info('adding space gap is: ' + (now - lastletter));
        }
        lastletter = now;
        telegram += message;
        newdataflag = true;
     }
  }

  logger.info('run_t ending  >' +  message + '<');
  await client.end();
}


function save() {  // save telegram to file
    fs.writeFile(saved_data, telegram, err => {
      if (err) {
          logger.info('error saving ' + saved_data + ' ' + err )
      } else {
          logger.info('saved ' + saved_data )
      }
    } );
}

function publish(dest, topic, message) {
    logger.info( 'app publish: dest: ' + dest + ' topic: ' +topic + ' msg: ' + message )

    const client = server_client;

    client.publish( topic, message, (err) => {
        if (err) {
            console.error('Publish error:', err);
            return false;
        }
    });

    return true;
}


app.get('/', (req, res) => {
  logger.info('normal app.get / ' )
  res.sendFile(path.join(__dirname, 'index.html'));
});


// Route to handle the form submission (POST request)
app.post('/submit-form', (req, res) => {

    const message = " " + req.body.textField; // Get the data from the text field
    selected_dests = req.body.destination; // selected dest
    logger.info( selected_dests )
    destinations = ['/' + local_name]  // sound messages to local as well as other destinations
    //destinations = []  // 

    if ( selected_dests !== undefined ) {
           destinations = destinations.concat( selected_dests );
    }
    destinations = [...new Set(destinations) ];

    // uniquify
    destinations = destinations.filter(function(elem, pos) {
              return destinations.indexOf(elem) == pos;
          })

    fs.writeFileSync('/tmp/selected_dests', destinations.join('|')); // remember for the telegraph listener

    topic = 'telegraph';

    for (var dest of destinations ) {
         publish(SERVER_URL, topic  + dest , message );
         logger.info( 'app.post destination ' + topic + dest + ' msg:' + message  );
    }

    check()
    //telegram += message;  // the publish will make it appear?
    logger.info('added to telegram >' + message + '<' );
    newdataflag = true;
    res.redirect('/'); // reload
 
});

app.post('/submit-clear', (req, res) => {
    logger.info('submit-clear');
    telegram = '';
    lasttimestamp = 0;
    res.redirect('/'); // reload
});

run_t().catch(console.error);

const server = app.listen(PORT, () => {
  logger.info(`Server is running on http://localhost:${PORT}`);
});
server.keepAliveTimeout = 60 * 1000 + 500;
