const path = require('path');
const fs = require('fs');

function saveUploadedFile(file) {
  return { path: file.path, filename: file.originalname };
}

function readFileText(filePath) {
  return fs.promises.readFile(filePath, 'utf8');
}

module.exports = { saveUploadedFile, readFileText };
