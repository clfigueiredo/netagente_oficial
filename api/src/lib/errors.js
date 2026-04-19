/**
 * Creates a structured HTTP error with status code.
 * @param {number} status - HTTP status code
 * @param {string} message - Error message
 */
const createError = (status, message) => {
    const err = new Error(message);
    err.status = status;
    return err;
};

module.exports = { createError };
