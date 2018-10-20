let candidates = [];

let steemer;

/**
 * Initializes the upvoter
 * @param {any} _steemer The instance of steemer used by the bot
 */
function init(_steemer) {
    steemer = _steemer;
}

/**
 * Adds a candidate to the upvote `candidates`
 * @param {string} author The author of the post
 * @param {string} permlink The permlink of the post
 */
function addCandidate(author, permlink) {
    candidates.push({author, permlink});
}

module.exports = {
    addCandidate,
    init
}