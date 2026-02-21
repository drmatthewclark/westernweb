const express = require('express');
const path = require('path');
const mqtt = require('async-mqtt');
const WebSocket = require("ws");
const cors = require('cors');
const app = express();
const PORT = 3000;
const BROKER_URL = 'mqtt://127.0.0.1:1883'; 

app.use(express.urlencoded({ extended: true })); 
app.use(express.static(path.join(__dirname, '.')));
app.use(cors());

var counter = 0
var currentdata = ' ';
var newdataflag = false;


function makemsg( msg ) {
   return "data: " + msg + "\n\n";
};



app.get('/events', function(req, res) {

   console.log('app.get/events invoked ', counter );
   res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive'
    });

    const resloop = () => {
      if (newdataflag) {
        counter = counter + 1
        finalmsg = makemsg( currentdata );
        console.log("app2 loop writing  \"" + currentdata + "\" msg count " + counter );
        res.write(finalmsg);
        currentdata = '';
        newdataflag = false;
        }
      }

      const interval = setInterval( () => {
           resloop();
      }, 500 );


     // Handle client disconnection
     req.on('close', () => {
        clearInterval(interval);
        res.end();
        console.log('Client disconnected, cleaning up resources.');
     });

     console.log('loop ended', counter );
     if (currentdata != "") {
        finalmsg = makemsg( currentdata );
        console.log( "app2.get final " +  finalmsg );
        res.write(finalmsg);
        currentdata = '';
        newdataflag = false;
     }
});



async function waitForMessage(client, topic) {
  return new Promise((resolve) => {
    const messageHandler = (t, message) => {
      console.log('waitForMessage', t, message );
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
  
  await client.subscribe(subscription, 0);
  console.log('run function subscribed and waiting for message...');

  while (true) {
     const message = await waitForMessage(client, subscription);
     currentdata = message;
     console.log('interpret function Received message: ' +  message );
     newdataflag = true;
  }
  // Clean up
  await client.end();
}

async function run_t() {

  const subscription  = 'telegraph';
  const client = await mqtt.connect(BROKER_URL);
  
  await client.subscribe(subscription, 0);

  console.log('run function subscribed and waiting for message...');
  // loop for listening for messages
  while (true) {
     const message = await waitForMessage(client, subscription);
     console.log('run telegraph function Received message: ' +  message);
     currentdata = message;
     console.log('run_t currentdata ' + currentdata );
     newdataflag = true;
  }

  // Clean up
  await client.end();
}

function publish(dest, topic, message) {
    console.log( 'nginx publish: dest: ' + dest + ' topic: ' +topic + ' msg: ' + message )
    client = mqtt.connect( 'mqtt://' + dest + ':1883' );
    client.publish( topic, message, (err) => {
        if (err) {
            console.error('Publish error:', err);
            return false;
        }
    });

    currentdata = message;
    console.log('publish currentdata ' + currentdata );
    newdataflag = true;
    return true;
}


app.get('/', (req, res) => {
  console.log('normal app.get / ' )
  res.sendFile(path.join(__dirname, 'index.html'));
});


// Route to handle the form submission (POST request)
app.post('/submit-form', (req, res) => {
    const message = req.body.textField; // Get the data from the text field
    selected_dests = req.body.destination; // selected dest
    console.log( selected_dests )
    destinations = ['127.0.0.1']

    if ( selected_dests !== undefined ) {
           destinations = destinations.concat( selected_dests );
    }
    destinations = [...new Set(destinations) ];
    console.log( 'app.post destinations ' + destinations );
    console.log( 'app.post message is ' + message );

    topic = 'telegraph' ;
    currentdata = message;
    for (const dest of destinations) {
       publish(dest, topic, message );
    }

    res.redirect('/'); // reload
    currentdata = message
    newdataflag = true
 
});

run_t().catch(console.error);
run_i().catch(console.error);

const server = app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
server.keepAliveTimeout = 60 * 1000 + 500;
