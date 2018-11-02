let steemer = require('./steemer');

const { test_environment } = require('../config');

/**
 * Initializes the converter
 * @param {steemer} _steemer The instance of steemer used by the bot
 */
function init(_steemer) {
    steemer = _steemer;
    setInterval(checkBalances, test_environment ? 10 * 60 * 1000 : 3 * 60 * 60 * 1000);
}

/** Checks the balances of @checky and powers them up if possible, also tries to buy Steem if any SBD is available. */
async function checkBalances() {
    let { sbd, sbdReward, steem, steemReward, vestingReward } = await steemer.getBalances();
    const sbdRewardFloat = parseFloat(sbdReward);
    const steemRewardFloat = parseFloat(steemReward);
    if(sbdRewardFloat || steemRewardFloat || parseFloat(vestingReward)) {
        if(test_environment) console.log('Claiming reward balances', sbdReward, steemReward, vestingReward);
        else await steemer.broadcastClaimRewardBalance(sbdReward, steemReward, vestingReward);
        sbd = (parseFloat(sbd) + sbdRewardFloat).toFixed(3) + ' SBD';
        steem = (parseFloat(steem) + steemRewardFloat).toFixed(3) + ' STEEM';
    }
    if(parseFloat(steem)) {
        if(test_environment) console.log('Powering up', steem);
        else steemer.broadcastTransferToVesting(steem);
    }
    const sbdFloat = parseFloat(sbd);
    if(sbdFloat) {
        const [lowestAsk, conversionRate] = await Promise.all([steemer.getLowestAsk(), steemer.getConversionRate()]);
        if(lowestAsk <= conversionRate) {
            const steemNeeded = (sbdFloat / lowestAsk).toFixed(3) + ' STEEM';
            if(test_environment) console.log('Creating limit order', sbd, steemNeeded)
            else steemer.broadcastLimitOrderCreate(sbd, steemNeeded);
        } else {
            if(test_environment) console.log('Converting', sbd, (sbdFloat / conversionRate).toFixed(3) + ' STEEM');
            else steemer.broadcastConvert(sbd);
        }
    }
}

module.exports = {
    init
}