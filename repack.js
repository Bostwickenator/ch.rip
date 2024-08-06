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


async function execCommand(command) {
    return new Promise((resolve, reject) => {
        const childProcess = spawn(command, {
            stdio: 'inherit',
            shell: true
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
        console.log(`File '${filepath}' does not contain both required lines ('title=' and 'album=')`);
        const folderMeta = parseBookInfo(title);
        lines.push(`title=${folderMeta.title}`);
        lines.push(`author=${folderMeta.author}`);
        lines.push(`artist=${folderMeta.author}; ${folderMeta.narrator}`);
        lines.push(`album_artist=Narrated by ${folderMeta.narrator}`);
    } else {
        const albumValue = lines[albumLineIndex].slice('album='.length);
        lines[titleLineIndex] = `title=${albumValue}`;
    }

    fs.writeFileSync(filepath, lines.join('\n'));
}

function getChapterTitle(filepath) {
    return new Promise((resolve, reject) => {
        const command = `ffprobe -show_entries format_tags="title" -v quiet "${filepath}"`;
        exec(command, { cwd: process.cwd() }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }

            const lines = stdout.split('\n');
            const titleRegex = /^TAG:title=(.*)$/;

            for (const line of lines) {
                const match = line.match(titleRegex);
                if (match) {
                    resolve(match[1]);
                    return;
                }
            }

            const start = '- ';
            const title = filepath.slice(filepath.lastIndexOf(start) + start.length, filepath.indexOf('.m4a'));
            resolve(title);
        });
    });
}

async function makeChaptersMetadata(folder, listAudioFiles, metadatafile) {
    console.log('Making metadata source file');

    const chapters = {};
    let count = 1;

    for (const audioFile of listAudioFiles) {
        const filePath = `${folder}\\${audioFile}`;
        const command = `ffprobe -v quiet -of csv=p=0 -show_entries format=duration "${filePath}"`;

        const { stdout } = await new Promise((resolve, reject) => {
            exec(command, { cwd: process.cwd() }, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve({ stdout, stderr });
            });
        });

        const durationInMicroseconds = parseInt(stdout.trim().replace('.', ''));
        const title = await getChapterTitle(filePath);

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

    const firstFile = path.join(folder, listAudioFiles[0]);
    const command = `ffmpeg -y -loglevel error -i "${firstFile}" -f ffmetadata "${metadatafile}"`;

    await new Promise((resolve, reject) => {
        exec(command, { cwd: process.cwd() }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            resolve({ stdout, stderr });
        });
    });

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

async function concatenateAllToOneWithChapters(folder, metadatafile, listAudioFiles) {
    const filename = `${title}.m4a`;
    console.log(`Concatenating chapters to ${filename}`);

    const cover = path.join(folder, 'cover.jpg');
    const tempFile = path.join(folder, 'i.m4a');

    await execCommand(`ffmpeg -hide_banner -y -f concat -safe 0 -i "${listAudioFiles}" -i "${metadatafile}" -map_metadata 1 "${tempFile}"`);
    await execCommand(`ffmpeg -i "${tempFile}" -i "${cover}" -c copy -disposition:v attached_pic "${filename}"`);

    fs.unlinkSync(tempFile);
}

// ... (rest of the script) 

if (require.main === module) {
    console.log(process.argv);

    const folder = process.argv[2].replace(/"/g, '');
    title = path.basename(folder).replace(/"/g, '');
    console.log(title);

    const listAudioFiles = fs.readdirSync(folder).filter(f => f.includes('.m4a'));
    listAudioFiles.sort();

    const metadatafile = path.join(folder, 'combined.metadata.txt');
    const listfile = path.join(folder, 'list_audio_files.txt');

    makeChaptersMetadata(folder, listAudioFiles, metadatafile)
        .then(() => {
            if (fs.existsSync(listfile)) {
                fs.unlinkSync(listfile);
            }

            let i = 0;

            for (const audioFile of listAudioFiles) {
                const filepathOld = path.join(folder, audioFile);
                const filepathNew = path.join(folder, `${i}.tmp`);
                i++;

                fs.copyFileSync(filepathOld, filepathNew);
                fs.appendFileSync(listfile, `file '${filepathNew}'\n`);
            }

            return concatenateAllToOneWithChapters(folder, metadatafile, listfile);
        })
        .then(() => {
            let i = 0;

            for (const audioFile of listAudioFiles) {
                const filepathNew = path.join(folder, `${i}.tmp`);
                i++;
                fs.unlinkSync(filepathNew);
            }
        })
}
