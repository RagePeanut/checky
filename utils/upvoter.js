const fs = require('fs');
const steno = require('steno');

let steemer = require('./steemer');

const { test_environment } = require('../config');

let state = {
    candidates: [],
    last_upvote: new Date().toJSON()
};

/**
 * Initializes the upvoter
 * @param {steemer} _steemer The instance of steemer used by the bot
 */
function init(_steemer) {
    // Updating `state` with the content of ./data/upvoter.json if the file exists 
    if(fs.existsSync('data')) {
        if(fs.existsSync('data/upvoter.json')) state = require('../data/upvoter');
    } else fs.mkdirSync('data');
    steemer = _steemer;
    const lastUpvoteDistance = new Date() - new Date(state.last_upvote);
    const upvoteInterval = test_environment ? 1.5 * 60 * 60 * 1000 : (24 / 9) * 60 * 60 * 1000; // 90 minutes in test environment, ~2.66 hours in production environment
    const firstUpvoteTimeout = upvoteInterval - lastUpvoteDistance;
    setTimeout(() => {
        upvoteRandomCandidate();
        setInterval(upvoteRandomCandidate, upvoteInterval);
    }, firstUpvoteTimeout);
}

/**
 * Adds a candidate to the upvote candidates
 * @param {string} author The author of the post
 * @param {string} permlink The permlink of the post
 */
function addCandidate(author, permlink) {
    state.candidates.push({author, permlink});
    updateStateFile();
}

/** Updates the ./data/upvoter.json file with the content of the state object */
function updateStateFile() {
    steno.writeFile('data/upvoter.json', JSON.stringify(state), err => {
        if(err && log_errors) console.error(err.message);
    });
}

/**
 * Upvotes a random candidate from the upvote candidates
 */
async function upvoteRandomCandidate() {
    if(state.candidates.length > 0) {
        const candidate = state.candidates[Math.floor(Math.random() * state.candidates.length)];
        state.candidates = [];
        if(test_environment) console.log('Upvoting', candidate.author, candidate.permlink);
        else await steemer.broadcastUpvote(candidate.author, candidate.permlink);
        state.last_upvote = new Date().toJSON();
        updateStateFile();
    }
}

module.exports = {
    addCandidate,
    init
}