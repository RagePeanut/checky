let steemer = require('./steemer');
const { test_environment } = require('../config');

let candidates = [];

/**
 * Initializes the upvoter
 * @param {steemer} _steemer The instance of steemer used by the bot
 */
function init(_steemer) {
    steemer = _steemer;
    setInterval(upvoteRandomCandidate, test_environment ? 30 * 60 * 1000 : (24 / 9) * 60 * 60 * 1000); // 30 minutes in test environment, ~2.66 hours in production environment
}

/**
 * Adds a candidate to the upvote `candidates`
 * @param {string} author The author of the post
 * @param {string} permlink The permlink of the post
 */
function addCandidate(author, permlink) {
    candidates.push({author, permlink});
}

/**
 * Upvotes a random candidate from the upvote `candidates`
 */
function upvoteRandomCandidate() {
    if(candidates.length > 0) {
        const candidate = candidates[Math.floor(Math.random() * candidates.length)];
        candidates = [];
        if(test_environment) console.log(candidate);
        else steemer.broadcastUpvote(candidate.author, candidate.permlink);
    }
}

module.exports = {
    addCandidate,
    init
}