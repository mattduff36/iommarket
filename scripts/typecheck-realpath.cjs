/* eslint-disable @typescript-eslint/no-require-imports -- Node --require preloads must be CommonJS. */
const fs = require("node:fs");
const { promisify } = require("node:util");

// Windows restricted sessions can reject native canonicalisation while normal
// path traversal succeeds. Preserve genuine access errors from both resolvers.
const nativeSync = fs.realpathSync.native;
fs.realpathSync.native = function (path, options) {
  try {
    return nativeSync(path, options);
  } catch (error) {
    if (error.code !== "EPERM") throw error;
    return fs.realpathSync(path, options);
  }
};

const nativeAsync = fs.realpath.native;
fs.realpath.native = function (path, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = undefined;
  }
  nativeAsync(path, options, (error, value) => {
    if (error?.code === "EPERM") {
      fs.realpath(path, options, callback);
    } else {
      callback(error, value);
    }
  });
};

const promiseRealpath = fs.promises.realpath.bind(fs.promises);
const fallbackRealpath = promisify(fs.realpath);
fs.promises.realpath = async function (path, options) {
  try {
    return await promiseRealpath(path, options);
  } catch (error) {
    if (error.code !== "EPERM") throw error;
    return fallbackRealpath(path, options);
  }
};
