let steemer = require('./steemer');
const { test_environment } = require('../config');

let save = {
    candidates: [],
    not_checked: []
};

/**
 * Initializes the upvoter
 * @param {steemer} _steemer The instance of steemer used by the bot
 */
function init(_steemer) {
    // Updating `save` with the content of ./data/save.json if the file exists 
    if(fs.existsSync('data')) {
        if(fs.existsSync('data/save.json')) save = require('../data/save');
    } else fs.mkdirSync('data');
    steemer = _steemer;
    setInterval(upvoteRandomCandidate, test_environment ? 1.5 * 60 * 60 * 1000 : (24 / 9) * 60 * 60 * 1000); // 90 minutes in test environment, ~2.66 hours in production environment
}

/**
 * Adds a candidate to the upvote candidates
 * @param {string} author The author of the post
 * @param {string} permlink The permlink of the post
 */
function addCandidate(author, permlink) {
    save.candidates.push({author, permlink});
    updateSaveFile();
}

/**
 * Updates the ./data/save.json file with the content of the save object (recursively called every `interval` seconds)
 */
function updateSaveFile() {
    steno.writeFile('data/save.json', JSON.stringify(save), err => {
        if(err && log_errors) console.error(err.message);
    });
}

/**
 * Upvotes a random candidate from the upvote candidates
 */
async function upvoteRandomCandidate() {
    if(save.candidates.length > 0) {
        const candidate = save.candidates[Math.floor(Math.random() * save.candidates.length)];
        save.candidates = [];
        if(test_environment) console.log(candidate);
        else {
            await steemer.broadcastUpvote(candidate.author, candidate.permlink);
            updateSaveFile();
        }
    }
}

module.exports = {
    addCandidate,
    init
}