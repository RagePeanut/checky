let candidates = [];

let steemer;

/**
 * Initializes the upvoter
 * @param {any} _steemer The instance of steemer used by the bot
 */
function init(_steemer) {
    steemer = _steemer;
    setInterval(upvoteRandomCandidate, (24 / 9) * 60 * 60 * 1000);
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
    const candidate = candidates[Math.floor(Math.random() * candidates.length)];
    candidates = [];
    steemer.broadcastUpvote(candidate.author, candidate.permlink);
}

module.exports = {
    addCandidate,
    init
}