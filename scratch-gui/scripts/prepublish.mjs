// From the NPM docs:
// "If you need to perform operations on your package before it is used, in a way that is not dependent on the
// operating system or architecture of the target system, use a prepublish script."
// Once this step is complete, a developer should be able to work without an Internet connection.
// See also: https://docs.npmjs.com/cli/using-npm/scripts

import fs from 'fs';
import path from 'path';

import crossFetch from 'cross-fetch';
import yauzl from 'yauzl';
import {fileURLToPath} from 'url';

/** @typedef {import('yauzl').Entry} ZipEntry */
/** @typedef {import('yauzl').ZipFile} ZipFile */

// these aren't set in ESM mode
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// base/root path for the project
const basePath = path.join(__dirname, '..');

/**
 * Extract the first matching file from a zip buffer.
 * The path within the zip file is ignored: the destination path is `${destinationDirectory}/${basename(entry.name)}`.
 * Prints warnings if more than one matching file is found.
 * @param {function(ZipEntry): boolean} filter Returns true if the entry should be extracted.
 * @param {string} relativeDestDir The directory to extract to, relative to `basePath`.
 * @param {Buffer} zipBuffer A buffer containing the zip file.
 * @returns {Promise<string>} A Promise for the base name of the written file (without directory).
 */
const extractFirstMatchingFile = (filter, relativeDestDir, zipBuffer) => new Promise((resolve, reject) => {
    try {
        let extractedFileName;
        yauzl.fromBuffer(zipBuffer, {lazyEntries: true}, (zipError, zipfile) => {
            if (zipError) {
                throw zipError;
            }
            zipfile.readEntry();
            zipfile.on('end', () => {
                resolve(extractedFileName);
            });
            zipfile.on('entry', entry => {
                if (!filter(entry)) {
                    // ignore non-matching file
                    return zipfile.readEntry();
                }
                if (extractedFileName) {
                    console.warn(`Multiple matching files found. Ignoring: ${entry.fileName}`);
                    return zipfile.readEntry();
                }
                extractedFileName = entry.fileName;
                console.info(`Found matching file: ${entry.fileName}`);
                zipfile.openReadStream(entry, (fileError, readStream) => {
                    if (fileError) {
                        throw fileError;
                    }
                    const baseName = path.basename(entry.fileName);
                    const relativeDestFile = path.join(relativeDestDir, baseName);
                    console.info(`Extracting ${relativeDestFile}`);
                    const absoluteDestDir = path.join(basePath, relativeDestDir);
                    fs.mkdirSync(absoluteDestDir, {recursive: true});
                    const absoluteDestFile = path.join(basePath, relativeDestFile);
                    const outStream = fs.createWriteStream(absoluteDestFile);
                    readStream.on('end', () => {
                        outStream.close();
                        zipfile.readEntry();
                    });
                    readStream.pipe(outStream);
                });
            });
        });
    } catch (error) {
        reject(error);
    }
});

/**
 * 检查目录中是否存在.hex文件
 * @param {string} dir 要检查的目录路径
 * @returns {string|null} 如果找到.hex文件，返回文件名；否则返回null
 */
const findExistingHexFile = (dir) => {
    if (!fs.existsSync(dir)) return null;
    
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (file.endsWith('.hex')) {
            return file;
        }
    }
    return null;
};

const downloadMicrobitHex = async () => {
    const relativeHexDir = path.join('static', 'microbit');
    const absoluteHexDir = path.join(basePath, relativeHexDir);
    
    // 检查是否已存在.hex文件
    const existingHexFile = findExistingHexFile(absoluteHexDir);
    let hexFileName;
    
    if (existingHexFile) {
        console.info(`find existing hex file: ${existingHexFile}`);
        hexFileName = existingHexFile;
    } else {
        // 不存在则下载
        const url = 'https://downloads.scratch.mit.edu/microbit/scratch-microbit.hex.zip';
        console.info(`Downloading ${url}`);
        const response = await crossFetch(url);
        const zipBuffer = Buffer.from(await response.arrayBuffer());
        
        // 确保目录存在
        fs.mkdirSync(absoluteHexDir, {recursive: true});
        
        hexFileName = await extractFirstMatchingFile(
            entry => /\.hex$/.test(entry.fileName),
            relativeHexDir,
            zipBuffer
        );
    }
    
    const relativeHexFile = path.join(relativeHexDir, hexFileName);
    const relativeGeneratedDir = path.join('src', 'generated');
    const relativeGeneratedFile = path.join(relativeGeneratedDir, 'microbit-hex-url.cjs');
    const absoluteGeneratedDir = path.join(basePath, relativeGeneratedDir);
    fs.mkdirSync(absoluteGeneratedDir, {recursive: true});
    const absoluteGeneratedFile = path.join(basePath, relativeGeneratedFile);
    const requirePath = `./${path
        .relative(relativeGeneratedDir, relativeHexFile)
        .split(path.win32.sep)
        .join(path.posix.sep)}`;
    fs.writeFileSync(
        absoluteGeneratedFile,
        [
            '// This file is generated by scripts/prepublish.mjs',
            '// Do not edit this file directly',
            '// This file relies on a loader to turn this `require` into a URL',
            `module.exports = require('${requirePath}');`,
            '' // final newline
        ].join('\n')
    );
    console.info(`Wrote ${relativeGeneratedFile}`);
};

const prepublish = async () => {
    await downloadMicrobitHex();
};

prepublish().then(
    () => {
        console.info('Prepublish script complete');
        process.exit(0);
    },
    e => {
        console.error(e);
        process.exit(1);
    }
);
