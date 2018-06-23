const _ = require('lodash');
const fs = require('fs');
const steemStream = require('steem');
const steemRequest = require('steem');
const { posting_key, request_nodes, stream_nodes } = require('./config');

steemRequest.api.setOptions({ url: request_nodes[0] });

let users = {};
if(fs.existsSync('data') && fs.existsSync('data/users.json')) users = require('data/users');
else fs.mkdirSync('data');

setInterval(() => 
    fs.writeFile('data/users.json', JSON.stringify(users), err => {
        if(err) console.log(err);
    })
, 5 * 1000);

stream();

function stream() {
    new Promise((resolve, reject) => {
        steemStream.api.setOptions({ url: stream_nodes[0] })
        steemStream.api.streamOperations((error, operation) => {
            if(error) return reject(error);

            const author = operation[1].author;
            const parent_author = operation[1].parent_author;
            const body = operation[1].body;
            const permlink = operation[1].permlink;

            if(operation && operation[0] === 'comment') {
                if(parent_author === 'checky') {
                    const command = /[!/]([A-Za-z]+)(?:\s+(.+))?/.exec(body);
                    if(command[1]) processCommand(command, author, permlink);
                } else if(parent_author === '' && users[author].mode !== 'off' || users[author] && users[author].mode === 'advanced') {
                    try {
                        const metadata = JSON.parse(operation[1].json_metadata);
                        // Removing the punctuation at the end of some mentions, lower casing mentions, removing duplicates and already encountered existing users
                        let mentions = _.uniq(metadata.users.map(user => user.replace(/[?¿!¡.,;:-]+$/, '').toLowerCase())).filter(user => !users[user]);
                        // Removing ignored mentions
                        if(users[author]) mentions = mentions.filter(mention => !users[author].ignored.includes(mention));
                        else users[author] = { mode: 'regular', ignored: [] };
                        if(mentions.length > 0) processCreatedPost(mentions, body, author, permlink);
                    } catch(err) {}
                }
            }
        });
    }).catch(error => {
        console.error(`Stream error: ${ error.message } with ${ stream_nodes[0] }`);
        // Putting the node where the error comes from at the end of the array
        stream_nodes.push(stream_nodes.shift());
        stream();
    });
}

function processCreatedPost(mentions, body, author, permlink) {
    new Promise((resolve, reject) => {
        steemRequest.api.getContent(author, permlink, (err, res) => {
            if(err) return reject(err);
            if(res.last_update === res.created) processMentions(mentions, body, author, permlink, res.title);
        });
    }).catch(error => {
        console.error(`Request error (getContent): ${ error.message } with ${ request_nodes[0] }`);
        // Putting the node where the error comes from at the end of the array
        request_nodes.push(request_nodes.shift());
        steemRequest.api.setOptions({ url: request_nodes[0] });
        console.log(`Retrying with ${ request_nodes[0] }`)
        processCreatedPost(mentions, body, author, permlink);
    });
}

function processMentions(mentions, body, author, permlink, title) {
    new Promise((resolve, reject) => {
        steemRequest.api.lookupAccountNames(mentions, (err, res) => {
            if(err) return reject(err);
            let wrongMentions = [];
            // Add each username that got a null result from the API (meaning the user doesn't exist) to the wrongMentions array
            for(let i = 0; i < mentions.length; i++) {
                if(res[i] === null) {
                    const regex = new RegExp('(?:^|[\\s\\S]{0,299}[^\\w/-])@' + _.escapeRegExp(mentions[i]) + '(?:[^\\w/-][\\s\\S]{0,299}|$)', 'gi');
                    const match = body.match(regex);
                    if(match && !/(insta|tele)gram|tw(itter|eet)|medium|brunch|텔레그램/i.test(match)) wrongMentions.push('@' + mentions[i]);
                } else users[mentions[i]] = { mode: 'regular', ignored: [] };
            }
            if(wrongMentions.length > 0) {
                let message = `Hi @${ author },`;
                if(wrongMentions.length > 1) {
                    wrongMentions = wrongMentions.map(mention => mention + ',');
                    wrongMentions[wrongMentions.length-1] = wrongMentions[wrongMentions.length-1].replace(',', '');
                    wrongMentions[wrongMentions.length-2] = wrongMentions[wrongMentions.length-2].replace(',', ' and');
                    message = message + ` while checking the users mentioned in this post I noticed that ${ wrongMentions.join(' ') } don't exist on Steem. Maybe you made some typos ?`
                } else {
                    message = message + ` the account ${ wrongMentions[0] } mentioned in this post doesn't seem to exist on Steem. Maybe you made a typo ?`;
                }
                sendMessage(message, author, permlink, 'Possible wrong mentions found on ' + title);
            }
            console.log(wrongMentions, author);
        });
    }).catch(error => {
        console.error(`Request error (lookupAccountNames): ${ error.message } with ${ request_nodes[0] }`);
        // Putting the node where the error comes from at the end of the array
        request_nodes.push(request_nodes.shift());
        steemRequest.api.setOptions({ url: request_nodes[0] });
        console.log(`Retrying with ${ request_nodes[0] }`)
        processMentions(mentions, body, author, permlink);
    });
}

function processCommand(command, author, permlink) {
    switch(command[1]) {
        case 'ignore':
            if(command[2]) {
                const mentions = command[2].split(/[\s,]+/).filter(mention => mention !== '').map(mention => mention.replace('@', ''));
                users[author].ignored = _.union(users[author].ignored, mentions);
                sendMessage(`The following mentions will now be ignored when made by you: ${ mentions.join(', ') }.\nIf for any reason you want to make @checky stop ignoring them, reply to any of my posts with "!unignore username1 username2 ...".`, author, permlink, `Added some ignored mentions for @${ author }`);
            } else sendMessage('You didn\'t specify any username to ignore. Please try again by using the format "!ignore username1 username2 ...".', author, permlink, 'No username specified');
            break;
        case 'unignore':
            if(command[2]) {
                const mentions = command[2].split(/[\s,]+/).filter(mention => mention !== '').map(mention => mention.replace('@', ''));
                mentions.forEach(mention => _.pull(users[author].ignored, mention));
                sendMessage(`The following mentions will now be inspected by @checky when made by you: ${ mentions.join(', ') }.\nIf for any reason you want to make @checky start ignoring them again, reply to any of my posts with "!ignore username1 username2 ...".`, author, permlink, `Removed some ignored mentions for @${ author }`);
            } else sendMessage('You didn\'t specify any username to unignore. Please try again by using the format "!unignore username1 username2 ...".', author, permlink, 'No username specified');
            break;
        case 'mode':
        case 'switch':
            if(command[2]) {
                const mode = _.trim(command[2]);
                switch(mode) {
                    case 'on':
                    case 'regular':
                    case 'normal':
                        users[author].mode = 'regular';
                        sendMessage('Your account mode has been set to regular. You will now only get your mentions checked for posts you make.');
                        break;
                    case 'advanced':
                    case 'plus':
                        users[author].mode = 'advanced';
                        sendMessage('Your account mode has been set to advanced. You will now get your mentions checked for posts and comments.');
                        break;
                    case 'off':
                        users[author].mode = 'off';
                        sendMessage('Your account mode has been set to off. You will now get no mentions checked whatsoever.');
                    default:
                        sendMessage(`The ${ mode } mode doesn't exist. Your account is currently set to ${ users[account].mode }. To switch it to regular, advanced or off, please write "!mode regular/advanced/off".`, author, permlink, 'Wrong mode specified');
                }
            } else sendMessage('You didn\'t spectify any mode to switch to. Please try again by using "!mode regular", "!mode advanced" or "!mode off".', author, permlink, 'No mode specified');
        default:
            sendMessage('This command doesn\'t exist.', author, permlink, 'Unknown command');
    }
}

function sendMessage(message, author, permlink, title) {
    const metadata = {
        app: 'checky/0.0.1',
        format: 'markdown',
        tags: [ 
            'mentions',
            'bot',
            'checky'
        ],
        users: [ author ]
    }
    steemRequest.broadcast.comment(posting_key, author, permlink, 'checky', 're-' + permlink, title, message, JSON.stringify(metadata), function(err) {
        console.log(err);
    });
}