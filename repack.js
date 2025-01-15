const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
let title = "";

function parseBookInfo(title) {
    const titleRegex = /^(.*)- Writ/;
    const authorRegex = /ten by (.*) -/;
    const narratorRegex = / Narrated by (.*)$/;

    const match = title.match(new RegExp(`${titleRegex.source}${authorRegex.source}${narratorRegex.source}`));

    if (!match) {
        throw new Error(`Could not parse book information from title: '${title}'`);
    }

    const titleExtracted = match[1].trim();
    const author = match[2] || null;
    const narrator = match[3] || null;

    return { title: titleExtracted, author, narrator };
}

async function spawnCommand(command, cwd) {
    return new Promise((resolve, reject) => {
        const childProcess = spawn(command, {
            stdio: 'inherit',
            shell: true,
            cwd: cwd || process.cwd(),
        });
        childProcess.on('error', (error) => {
            reject(error);
        });
        childProcess.on('exit', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Command exited with code ${code}.`));
            }
        });
    });
};

async function execCommand(command, cwd) {
    return new Promise((resolve, reject) => {
        exec(command, { cwd: cwd || process.cwd(), }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            resolve({ stdout, stderr });
        });
    });
};

function updateTitleWithAlbum(filepath) {
    const content = fs.readFileSync(filepath, 'utf-8');
    const lines = content.split('\n');

    let titleLineIndex = null;
    let albumLineIndex = null;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('title=')) {
            titleLineIndex = i;
        } else if (lines[i].startsWith('album=')) {
            albumLineIndex = i;
        }
    }

    if (titleLineIndex === null || albumLineIndex === null) {
        console.log(`File '${filepath}' does not contain both required lines ('title=' and 'album=') using folder name instead`);
        const folderMeta = parseBookInfo(title);
        lines.push(`title=${folderMeta.title}`);
        lines.push(`album=${folderMeta.title}`);
        lines.push(`author=${folderMeta.author}`);
        lines.push(`artist=${folderMeta.author}; Narrated by ${folderMeta.narrator}`);
        lines.push(`album_artist=${folderMeta.author}`);
    } else {
        const albumValue = lines[albumLineIndex].slice('album='.length);
        lines[titleLineIndex] = `title=${albumValue}`;
    }

    fs.writeFileSync(filepath, lines.join('\n'));
}

async function getChapterTitle(filepath) {
    const command = `ffprobe -show_entries format_tags="title" -v quiet "${filepath}"`;
    const { stdout } = await execCommand(command);

    const lines = stdout.split('\n');
    const titleRegex = /^TAG:title=(.*)$/;

    for (const line of lines) {
        const match = line.match(titleRegex);
        if (match) {
            return match[1];
        }
    }

    const start = '- ';
    const title = filepath.slice(filepath.lastIndexOf(start) + start.length, filepath.indexOf('.m4a'));
    return title;
}

function mergeIdenticalContigiousChapters(chapters) {
    const mergedChapters = {};
    let currentChapter = null;

    for (const [key, chapter] of Object.entries(chapters)) {
        if (currentChapter && currentChapter.title === chapter.title) {
            currentChapter.end = chapter.end;
        } else {
            if (currentChapter) {
                mergedChapters[currentChapter.key] = currentChapter;
            }
            currentChapter = { ...chapter, key };
        }
    }

    if (currentChapter) {
        mergedChapters[currentChapter.key] = currentChapter;
    }

    return mergedChapters;
}

async function makeChaptersMetadata(listAudioFiles, metadatafile) {
    console.log('Making metadata source file');

    let chapters = {};
    let count = 1;

    for (const audioFile of listAudioFiles) {
        const command = `ffprobe -v quiet -of csv=p=0 -show_entries format=duration "${audioFile}"`;

        const {stdout} = await execCommand(command);

        const durationInMicroseconds = parseInt(stdout.trim().replace('.', ''));
        const title = await getChapterTitle(audioFile);

        chapters[`${count.toString().padStart(4, '0')}`] = { duration: durationInMicroseconds, title };
        count++;
    }

    chapters['0001'].start = 0;

    for (let n = 1; n < Object.keys(chapters).length; n++) {
        const chapter = n.toString().padStart(4, '0');
        const nextChapter = (n + 1).toString().padStart(4, '0');

        chapters[chapter].end = chapters[chapter].start + chapters[chapter].duration;
        chapters[nextChapter].start = chapters[chapter].end + 1;
    }

    const lastChapter = Object.keys(chapters).length.toString().padStart(4, '0');
    chapters[lastChapter].end = chapters[lastChapter].start + chapters[lastChapter].duration;

    chapters = mergeIdenticalContigiousChapters(chapters);

    const firstFile = listAudioFiles[0];
    const command = `ffmpeg -y -loglevel error -i "${firstFile}" -f ffmetadata "${metadatafile}"`;

    await execCommand(command);

    updateTitleWithAlbum(metadatafile);

    const chapterMetadata = Object.entries(chapters).map(([chapter, data]) => `
[CHAPTER]
TIMEBASE=1/1000000
START=${data.start}
END=${data.end}
title=${data.title}
`).join('');

    fs.appendFileSync(metadatafile, chapterMetadata);
    console.log(chapterMetadata);
}

async function concatenateAllToOneWithChapters(metadatafile, listAudioFiles) {
    const filename = `${title}.m4a`;
    console.log(`Concatenating chapters to ${filename}`);

    const cover = 'cover.jpg';
    const tempFile = 'i.m4a';

    await spawnCommand(`ffmpeg -hide_banner -y -f concat -safe 0 -i "${listAudioFiles}" -i "${metadatafile}" -map_metadata 1 "${tempFile}"`);

    console.log("Adding cover image");
    await spawnCommand(`ffmpeg -hide_banner -loglevel error -i "${tempFile}" -i "${cover}" -c copy -disposition:v attached_pic "${filename}"`);

    fs.renameSync(filename, path.join('..', filename));

    fs.unlinkSync(tempFile);
}

function createFileList(listAudioFiles, listFilePath){
    if (fs.existsSync(listFilePath)) {
        fs.unlinkSync(listFilePath);
    }
    
    let i = 0;
    for (const audioFile of listAudioFiles) {
        //FFMPEG escapes just don't work, so we have to replace the single quote with a different character
        const audioFileSafe = audioFile.replaceAll("'", "’");
        if(audioFileSafe !== audioFile){
            fs.renameSync(audioFile, audioFileSafe);
        }
        fs.appendFileSync(listFilePath, `file '${audioFileSafe}'\n`);
    }
}

if (require.main === module) {
    console.log(process.argv);

    const folder = process.argv[2].replace(/"/g, '');
    title = path.basename(folder).replace(/"/g, '');
    console.log(title);

    let listAudioFiles = fs.readdirSync(folder).filter(f => f.includes('.m4a'));
    
    // Make sure we don't include any temp files in case we crashed previously
    listAudioFiles = listAudioFiles.filter(f => f !== 'i.m4a' && f !== `${title}.m4a`);
    
    listAudioFiles.sort();

    const metadataFilePath ='combined.metadata.txt';
    const listFilePath ='list_audio_files.txt';
   
    process.chdir(folder)

    makeChaptersMetadata(listAudioFiles, metadataFilePath)
        .then(() => {
            createFileList(listAudioFiles, listFilePath);
            return concatenateAllToOneWithChapters(metadataFilePath, listFilePath);
        })
        .then(() => {
           console.log("Completed successfully")
           console.log("🐤.🪦");
        })
}
