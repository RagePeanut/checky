const _ = require('lodash');
const steemStream = require('steem');
const steemRequest = require('steem');
const { posting_key, request_nodes, stream_nodes } = require('./config');

steemRequest.api.setOptions({ url: request_nodes[0] });

stream();

function stream() {
    new Promise((resolve, reject) => {
        steemStream.api.setOptions({ url: stream_nodes[0] })
        steemStream.api.streamOperations((error, operation) => {
            if(error) return reject(error);
            if(operation && operation[0] === 'comment' && operation[1].parent_author === '') {
                try {
                    const metadata = JSON.parse(operation[1].json_metadata);
                    // Removing the punctuation at the end of some mentions and lower casing mentions
                    let mentions = metadata.users.map(user => user.replace(/[?¿!¡.,;:-]+$/, '').toLowerCase());
                    // Removing duplicates
                    mentions = _.uniq(mentions);
                    processCreatedPost(mentions, operation[1].body, operation[1].author, operation[1].permlink);
                } catch(err) {}
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
            const wrongMentions = [];
            // Add each username that got a null result from the API (meaning the user doesn't exist) to the wrongMentions array
            for(let i = 0; i < mentions.length; i++) {
                if(res[i] === null) {
                    const regex = new RegExp('(?:^|[\\s\\S]{0,299}[^\\w/-])@' + _.escapeRegExp(mentions[i]) + '(?:[^\\w/-][\\s\\S]{0,299}|$)', 'gi');
                    const match = body.match(regex);
                    if(match && !/(insta|tele)gram|tw(itter|eet)|medium|brunch|텔레그램/i.test(match)) wrongMentions.push('@' + mentions[i]);
                }
            }
            if(wrongMentions.length > 0) {
                sendMessage(wrongMentions, author, permlink, title);
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

function sendMessage(wrongMentions, author, permlink, title) {
    let message = `Hi @${ author },`;
    if(wrongMentions.length > 1) {
        wrongMentions = wrongMentions.map(mention => mention + ',');
        wrongMentions[wrongMentions.length-1] = wrongMentions[wrongMentions.length-1].replace(',', '');
        wrongMentions[wrongMentions.length-2] = wrongMentions[wrongMentions.length-2].replace(',', ' and');
        message = message + ` while checking the users mentioned in this post I noticed that ${ wrongMentions.join(' ') } don't exist on Steem. Maybe you made some typos ?`
    } else {
        message = message + ` the account ${ wrongMentions[0] } mentioned in this post doesn't seem to exist on Steem. Maybe you made a typo ?`;
    }
    const metadata = {
        app: 'checky/0.0.1',
        format: 'markdown',
        tags: [ 
            'mentions',
            'bot'
        ],
        users: [ author ]
    } 
    steemRequest.broadcast.comment(posting_key, author, permlink, 'checky', 're-' + permlink + Math.random().toString(36).slice(2), 'Possible wrong mentions found on "' + title + '"', message, JSON.stringify(metadata), function(err, result) {
        console.log(err, result);
    });
}