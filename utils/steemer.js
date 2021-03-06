const steem = require('steem');
const { capitalize } = require('./helper');
const { fail_safe_node, log_errors } = require('../config');

const activeKey = process.env.CHECKY_ACTIVE_KEY;

let nodes = [fail_safe_node];

/**
 * Claims the reward balances of @checky
 * @param {string} sbdBalance The SBD reward balance
 * @param {string} steemBalance The Steem reward balance
 * @param {string} vestingBalance The vesting shares reward balance
 */
async function claimRewardBalance(sbdBalance, steemBalance, vestingBalance) {
    try {
        await steem.broadcast.claimRewardBalanceAsync(activeKey, 'checky', steemBalance, sbdBalance, vestingBalance);
        return;
    } catch(err) {
        handleError(err, 'broadcast', 'claimRewardBalance');
        return await claimRewardBalance(sbdBalance, steemBalance, vestingBalance);
    }
}

/**
 * Broadcasts a comment
 * @param {string} parentAuthor The author of the post to reply to
 * @param {string} parentPermlink The permlink of the post to reply to
 * @param {string} title The title of the comment
 * @param {string} body The body of the comment
 * @param {string} jsonMetadata The stringified metadata attached to the comment
 * @returns {Promise<void>} An empty promise resolved after the comment has been broadcasted
 */
async function comment(parentAuthor, parentPermlink, title, body, jsonMetadata) {
    const permlink = 're-' + parentAuthor.replace(/\./g, '') + '-' + parentPermlink;
    try {
        await steem.broadcast.commentAsync(activeKey, parentAuthor, parentPermlink, 'checky', permlink, title, body, jsonMetadata);
        return;
    } catch(err) {
        handleError(err, 'broadcast', 'comment');
        return await comment(parentAuthor, parentPermlink, title, body, jsonMetadata);
    }
}

/**
 * Converts SBD to Steem
 * @param {string} sbdAmount The amount of SBD to convert
 * @returns {Promise<void>} An empty promise resolved after the SBD have been converted to Steem
 */
async function convert(sbdAmount) {
    try {
        const requestId = Math.random() * 1000000 << 0;
        await steem.broadcast.convertAsync(activeKey, 'checky', requestId, sbdAmount);
        return;
    } catch(err) {
        handleError(err, 'broadcast', 'convert');
        return await convert(sbdAmount);
    }
}

/**
 * Creates a limit order
 * @param {string} sellingSBD The amount of SBD to sell
 * @param {string} receivingSteem The amount of Steem to receive
 * @returns {Promise<void>} An empty promise resolved after the limit order has been created
 */
async function createLimitOrder(sellingSBD, receivingSteem) {
    try {
        const orderId = Math.random() * 1000000 << 0;
        const expirationDate = new Date(Date.now() + 10 * 60 * 1000).toISOString().split('.')[0];
        await steem.broadcast.limitOrderCreateAsync(activeKey, 'checky', orderId, sellingSBD, receivingSteem, false, expirationDate);
        return;
    } catch(err) {
        handleError(err, 'broadcast', 'limitOrderCreate');
        return await createLimitOrder(sellingSBD, receivingSteem);  
    }
}

/**
 * Deletes a comment
 * @param {string} permlink The permlink of the comment
 * @returns {Promise<void>} An empty promise resolved after the comment has been deleted
 */
async function deleteComment(permlink) {
    try {
        await steem.broadcast.deleteCommentAsync(activeKey, 'checky', permlink);
        return;
    } catch(err) {
        handleError(err, 'broadcast', 'deleteComment');
        return await deleteComment(permlink);
    }
}

/** 
 * Gets the SBD, Steem and reward balances of @checky
 * @returns {Promise<{sbd: string, sbdReward: string, steem: string, steemReward: string, vestingReward: string}>} The bot's SBD, Steem and reward balances
 */
async function getBalances() {
    try {
        const { balance, reward_sbd_balance, reward_steem_balance, reward_vesting_balance, sbd_balance } = (await steem.api.getAccountsAsync(['checky']))[0];
        return {
            sbd: sbd_balance,
            sbdReward: reward_sbd_balance,
            steem: balance,
            steemReward: reward_steem_balance,
            vestingReward: reward_vesting_balance
        };
    } catch(err) {
        handleError(err, 'request', 'getAccounts');
        return await getBalances();
    }
}

/**
 * Gets the content of a post
 * @param {string} author The author of the post
 * @param {string} permlink The permlink of the post
 * @returns {Promise<any>} The content of the post
 */
async function getContent(author, permlink) {
    try {
        const content = await steem.api.getContentAsync(author, permlink);
        return content;
    } catch(err) {
        handleError(err, 'request', 'getContent');
        return await getContent(author, permlink);
    }
}

/**
 * Gets the conversion rate in SBD for 1 Steem
 * @returns {Promise<number>} The conversion rate
 */
async function getConversionRate() {
    try {
        const { base, quote } = await steem.api.getCurrentMedianHistoryPriceAsync();
        return parseFloat(base) / parseFloat(quote);
    } catch(err) {
        handleError(err, 'request', 'getCurrentMedianHistoryPrice');
        return await getConversionRate();
    }
}

/**
 * Gets the followers and the followees of `account`
 * @param {string} account The username of the account
 * @returns {Promise<Set<string>>} The follow circle of `account`
 */
async function getFollowCircle(account) {
    const [followers, followees] = await Promise.all([getFollowers(account, ''), getFollowees(account, '')]);
    const followCircle = new Set(followers);
    followees.forEach(followee => followCircle.add(followee));
    return followCircle;
}

/**
 * Gets the followers of `account`
 * @param {string} account The username of the account
 * @param {string} [start] The username to start at (included)
 * @returns {Promise<string[]>} The followers of `account`
 */
async function getFollowers(account, start = '') {
    try {
        const followers = await steem.api.getFollowersAsync(account, start, 'blog', 1000);
        if(followers.length < 1000) return followers.map(relation => relation.follower);
        else {
            start = followers[followers.length - 1].follower.replace(/.$/, match => String.fromCharCode(match.charCodeAt(0) + 1));
            return followers.map(relation => relation.follower).concat(await getFollowers(account, start));
        }
    } catch(err) {
        handleError(err, 'request', 'getFollowers');
        return await getFollowers(account, start);
    }
}

/**
 * Gets the followees of `account`
 * @param {string} account The username of the account
 * @param {string} [start] The username to start at (included)
 * @returns {Promise<string[]>} The followees of `account`
 */
async function getFollowees(account, start = '') {
    try {
        const followees = await steem.api.getFollowingAsync(account, start, 'blog', 1000);
        if(followees.length < 1000) return followees.map(relation => relation.following);
        else {
            start = followees[followees.length - 1].following.replace(/.$/, match => String.fromCharCode(match.charCodeAt(0) + 1));
            return followees.map(relation => relation.following).concat(await getFollowees(account, start));
        }
    } catch(err) {
        handleError(err, 'request', 'getFollowing');
        return await getFollowees(account, start);
    }
}

/**
 * Gets the best price to buy Steem at on the market
 * @returns {Promise<number>} The best price to buy Steem at on the market
 */
async function getLowestAsk() {
    try {
        const { lowest_ask } = await steem.api.getTickerAsync();
        return parseFloat(lowest_ask);
    } catch(err) {
        handleError(err, 'request', 'getTicker');
        return await getLowestAsk();
    }
}

/**
 * Gets the tags used by `author`
 * @param {string} author The author that used those tags
 * @returns {Promise<string[]>} The tags used by `author`
 */
async function getTagsByAuthor(author) {
    try {
        const tags = await steem.api.getTagsUsedByAuthorAsync(author);
        return tags.map(tag => tag.name);
    } catch(err) {
        handleError(err, 'request', 'getTagsUsedByAuthor');
        return await getTagsByAuthor(author);
    }
}

/**
 * Gets the 1000 first trending tags
 * @returns {Promise<string[]>} The 1000 first trending tags
 */
async function getTrendingTags() {
    try {
        const tags = await steem.api.getTrendingTagsAsync('', 1000);
        return tags.map(tag => tag.name);
    } catch(err) {
        handleError(err, 'request', 'getTrendingTags');
        return await getTrendingTags();
    }
}

/** 
 * Handles an error
 * @param {any} error The error to handle
 * @param {string} type The type of interaction with the Steem blockchain that threw the error
 * @param {string} origin The name of the function that threw the error
 */
function handleError(error, type, origin) {
    if(log_errors) console.error(`${ capitalize(type) } error (${ origin }): ${ error.message } with ${ nodes[0] }`);
    // Putting the node where the error comes from at the end of the array
    nodes.push(nodes.shift());
    steem.api.setOptions({ url: nodes[0] });
    if(log_errors) console.log(`Retrying with ${ nodes[0] }`);   
}

/**
 * Checks if the `usernames` exist on the blockchain
 * @param {string[]} usernames The usernames to check
 * @returns {Promise<string[]>} The usernames that exist on the blockchain 
 */
async function lookupAccountNames(usernames) {
    try {
        const result = await steem.api.lookupAccountNamesAsync(usernames);
        return result.filter(user => user).map(user => user.name);
    } catch(err) {
        handleError(err, 'request', 'lookupAccountNames');
        return await lookupAccountNames(usernames);
    }
}

/**
 * Powers up some Steem
 * @param {string} steemAmount The amount of Steem to power up
 * @returns {Promise<void>} An empty promise resolved after the power up happened
 */
async function powerUp(steemAmount) {
    try {
        await steem.broadcast.transferToVestingAsync(activeKey, 'checky', 'checky', steemAmount);
        return;
    } catch(err) {
        handleError(err, 'broadcast', 'transferToVesting');
        return await powerUp(steemAmount); 
    }
}

/**
 * Updates the nodes used by the bot
 * @param {function():string[]} callback The callback that is called when new nodes are received
 */
function updateNodes(callback) {
    steem.api.getAccounts(['fullnodeupdate'], (err, res) => {
        if(err) {
            handleError(err, 'request', 'getAccounts');
            return updateNodes(callback);
        }
        const newNodes = JSON.parse(res[0].json_metadata).nodes.filter(node => !/^wss/.test(node));
        const gotNewNodes = newNodes.length > 0;
        if(gotNewNodes) {
            nodes = newNodes;
            callback(newNodes);
        }
        steem.api.setOptions({ url: nodes[0] });
        setInterval(updateNodes, 3 * 60 * 60 * 1000, callback);
    });
}

/**
 * Broadcasts an upvote
 * @param {string} author The author of the post to upvote
 * @param {string} permlink The permlink of the post to upvote
 * @returns {Promise<void>} An empty promise resolved after the upvote has been broadcasted
 */
async function upvote(author, permlink) {
    try {
        await steem.broadcast.voteAsync(activeKey, 'checky', author, permlink, 10000);
        return;
    } catch(err) {
        handleError(err, 'broadcast', 'vote');
        return await upvote(author, permlink);
    }
}

module.exports = {
    claimRewardBalance,
    comment,
    convert,
    createLimitOrder,
    deleteComment,
    getBalances,
    getContent,
    getConversionRate,
    getFollowCircle,
    getLowestAsk,
    getTagsByAuthor,
    getTrendingTags,
    lookupAccountNames,
    powerUp,
    updateNodes,
    upvote
}