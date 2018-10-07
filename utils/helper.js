/**
 * Merges arrays into one array with unique values
 * @param  {...any[]} arrays The arrays to merge
 */
function merge(...arrays) {
    const arr = [];
    for(let i = 0; i < arrays.length; i++) {
        arrays[i].forEach(elt => {
            if(!arr.includes(elt)) arr.push(elt);
        });
    }
    return arr;
}

/**
 * Removes the padding from a string
 * @param {string} str The string to trim
 * @returns {string} The unpadded string
 */
function trim(str) {
    return str.replace(/^\s+|\s+$/g, '');
}

/**
 * Removes duplicate, null and undefined values from an array
 * @param {any[]} array The array possibly containing duplicates, null and undefined values
 * @returns {any[]} The array without duplicate, null and undefined values
 */
function uniqCompact(array) {
    const arr = [];
    array.forEach(elt => {
        if(elt != null && !arr.includes(elt)) arr.push(elt);
    });
    return arr;
}

module.exports = {
    merge,
    trim,
    uniqCompact
}