const path = require('path');

function getStorageRoot() {
  const configured = process.env.PERSISTENT_DISK_PATH;
  if (configured && String(configured).trim()) {
    const trimmed = String(configured).trim();
    return path.isAbsolute(trimmed) ? trimmed : path.join(process.cwd(), trimmed);
  }
  return path.join(__dirname, '..');
}

function getDataDir() {
  return path.join(getStorageRoot(), 'data');
}

function getUploadsDir() {
  return path.join(getStorageRoot(), 'uploads');
}

module.exports = {
  getStorageRoot,
  getDataDir,
  getUploadsDir,
};
