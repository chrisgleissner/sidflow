const { rmSync } = require('node:fs');
const { rm } = require('node:fs/promises');

function remove(target, options) {
  return rm(target, { recursive: true, force: true }).catch((error) => {
    if (error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  });
}

function rimraf(target, callback) {
  const promise = remove(target);
  if (typeof callback === 'function') {
    promise.then(() => callback(null), callback);
    return;
  }
  return promise;
}

rimraf.sync = function rimrafSync(target) {
  try {
    rmSync(target, { recursive: true, force: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
};

rimraf.promise = function rimrafPromise(target) {
  return remove(target);
};

rimraf.promises = {
  rimraf: remove,
};

module.exports = rimraf;
