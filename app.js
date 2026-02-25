const winston = require('winston');
require('winston-syslog');
const express = require('express');
const path = require('path');
const mqtt = require('async-mqtt');
const cors = require('cors');
const app = express();
const PORT = 3000;
const BROKER_URL = 'mqtt://127.0.0.1:1883'; 

var counter = 0
var telegram = '';       // accumulated message 
var newdataflag = false;
var timestampinterval = 5 * 60 * 1000; // interval between stamps
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


// make a SSE mesage from the data
function makemsg( msg ) {
   return "data: " + telegram + "\n\n";
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
       lasttimestamp = new Date();
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
      if (t === topic) {
        resolve(message.toString());
        client.off('message', messageHandler); // listener is off
      }
    };
    // Attach the handler
    client.on('message', messageHandler); // listener is on
  });
}



async function run_i() {

  const subscription  = 'interpret';
  const client = await mqtt.connect(BROKER_URL);
  lastletter = 0 
  await client.subscribe(subscription, 0);
  logger.info('run_i function subscribed and waiting for message...');

  while (true) {
     message = await waitForMessage(client, subscription);
     check();
     now = new Date();
     if ((now - lastletter) > 3000) {  // space between words time in milliseconds
        message = " " + message;
     }
     lastletter = now;
     telegram += message;
     newdataflag = true;
     logger.info('run_i received message: >' +  message + '<');
  }

  logger.info('run_i ending  >' +  message + '<');
  await client.end();
}

async function run_t() {

  const subscription  = 'telegraph';
  const client = await mqtt.connect(BROKER_URL);
  
  await client.subscribe(subscription, 0);

  logger.info('run_t function subscribed and waiting for message...');
  // loop for listening for messages
  while (true) {
     const message = await waitForMessage(client, subscription);
     if (message != ''){
        check();
        logger.info('run_t received message: >' +  message + '<');
        telegram += " " + message;
        newdataflag = true;
     }
  }

  logger.info('run_t ending  >' +  message + '<');
  await client.end();
}

function publish(dest, topic, message) {
    logger.info( 'app publish: dest: ' + dest + ' topic: ' +topic + ' msg: ' + message )
    client = mqtt.connect( 'mqtt://' + dest + ':1883' );

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
    destinations = ['127.0.0.1']

    if ( selected_dests !== undefined ) {
           destinations = destinations.concat( selected_dests );
    }
    destinations = [...new Set(destinations) ];
    logger.info( 'app.post destinations ' + destinations );
    logger.info( 'app.post message is ' + message );

    topic = 'telegraph';

    for (const dest of destinations) {
       publish(dest, topic, message );
    }

    //telegram += message;
    newdataflag = true
    res.redirect('/'); // reload
 
});

app.post('/submit-clear', (req, res) => {
    logger.info('submit-clear');
    telegram = '';
    lasttimestamp = 0;
    res.redirect('/'); // reload
});

run_t().catch(console.error);
run_i().catch(console.error);

const server = app.listen(PORT, () => {
  logger.info(`Server is running on http://localhost:${PORT}`);
});
server.keepAliveTimeout = 60 * 1000 + 500;
