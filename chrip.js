const { Builder, Browser, By, until } = require('selenium-webdriver')
const chrome = require('selenium-webdriver/chrome');
const { install, Browser: PuppeteerBrowser } = require('@puppeteer/browsers');
const { Readable } = require('node:stream')
const { writeFile } = require('node:fs/promises')
const fs = require('fs');
const path = require('path');

let driver;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function filename(name) {
    return name.replaceAll('&', 'and').replaceAll(':', ' -').replaceAll(/[^a-z0-9 ._-]+/ig, '');
}

function getResumeStatusMessage(existingFiles, count) {
    if (count > 1) {
        // Find the previous chapter file and extract its name
        const prevTrackNum = (count - 1).toString().padStart(4, "0");
        const prevFile = existingFiles.find(f => f.includes(` - ${prevTrackNum} - `));
        if (prevFile) {
            // Extract chapter name: everything after " - XXXX - " and before ".m4a"
            const chapterMatch = prevFile.match(/ - \d{4} - (.+)\.m4a$/);
            const prevChapterName = chapterMatch ? chapterMatch[1] : null;
            if (prevChapterName) {
                return `Ready! Navigate to chapter after '${prevChapterName}' and hit play`;
            }
        }
    }
    return `Ready! Navigate to chapter ${count} and hit play`;
}

// Helper function to extract audiobook data from listing page JSON
async function getAudiobookDataFromListing() {
    try {
        const element = await driver.findElement(By.css('[data-audiobook]'));
        const dataAttr = await element.getAttribute('data-audiobook');
        if (dataAttr) {
            try {
                return JSON.parse(dataAttr);
            } catch (parseErr) {
                console.warn('Failed to parse audiobook data JSON:', parseErr.message);
                return null;
            }
        }
    } catch (e) {
        // Element not found or no data attribute
        return null;
    }
    return null;
}

// Wait for play button to be clickable
async function waitForPlayButton(timeoutMs) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        const playerButtons = await driver.findElements(By.css('.play-pause'));
        if (playerButtons.length) {
            return true;
        }

        await sleep(500);
    }

    return false;
}

const PLAYER_URL_EXPR = /\/player\/\d+/
const LIBRARY_URL_EXPR = /\/library/
const DETAILS_URL_EXPR = /\/audiobooks\/.+/

async function getCurrentPage() {
    const currentUrl = await driver.getCurrentUrl();
    if (PLAYER_URL_EXPR.test(currentUrl)) return "player"
    if (LIBRARY_URL_EXPR.test(currentUrl)) return "library"
    if (DETAILS_URL_EXPR.test(currentUrl)) return "audiobook"
    return undefined
}

async function getCover(dirname, coverUrlFromListing = null) {
    let src;

    // Try to use listing data first if available
    if (coverUrlFromListing) {
        src = coverUrlFromListing;
    } else {
        // Fallback to DOM selector
        try {
            src = await driver.findElement(By.className("cover-image")).getAttribute('src');
        } catch (e) {
            console.error('Could not find cover image:', e.message);
            return;
        }
    }

    try {
        const response = await fetch(src);
        const body = Readable.fromWeb(response.body);
        await writeFile(path.join(dirname, 'cover.jpg'), body);
        console.log('Cover image downloaded successfully');
    } catch (e) {
        console.error('Failed to download cover image:', e.message);
    }
}

async function getCredits(creditsFromListing = null) {
    // Try to use listing data first if available
    if (creditsFromListing && creditsFromListing.authorCredits && Array.isArray(creditsFromListing.authorCredits)) {
        try {
            const authors = creditsFromListing.authorCredits
                .filter(a => a && a.name)
                .map(a => a.name)
                .join(' - ');
            if (authors) {
                return filename(`Written by ${authors}`);
            }
        } catch (err) {
            console.warn('Error processing author credits from listing:', err.message);
        }
    }

    // Fallback to DOM selector
    try {
        const credits = await driver.findElements(By.className("credit"))
        let cred = ""
        for (let i = 0; i < credits.length; i++) {
            cred += cred.length != 0 ? ' - ' : '';
            cred += await credits[i].getText()
        }
        return filename(cred)
    } catch (e) {
        console.error('Could not extract credits:', e.message);
        return filename('Unknown Author');
    }
}

async function login() {
    // Wait for document ready state to be 'complete'
    await driver.wait(async () => {
        const readyState = await driver.executeScript('return document.readyState');
        return readyState === 'complete';
    }, 10000); // 10 second timeout

    // If there was a valid previous session still, do nothing more
    const currentUrl = await driver.getCurrentUrl();
    if (currentUrl.endsWith("/home")) return;

    await driver.get('https://www.chirpbooks.com/users/sign_in')

    await driver.wait(until.titleContains('Sign'), 1000)

    await driver.executeScript('document.querySelector("h1").textContent="Please sign-in to continue script"');

    await driver.wait(until.titleContains('Home'), 60 * 1000)
    await sleep(1000)
}

async function resetToLibrary() {
    await driver.get('https://www.chirpbooks.com/library');

    while ((await getCurrentPage()) === "library") {
        await sleep(1000)

        const allTabs = await driver.getAllWindowHandles();
        for (let tab of allTabs) {
            await driver.switchTo().window(tab); // Switch to the current tab
            // Check matching criteria (replace with your actual conditions)
            const url = await driver.getCurrentUrl();
            const tabPage = await getCurrentPage()
            if (tabPage === "player") { // Example: Matching by title
                console.log("Found matching tab:", url);
                break; // Exit loop if you only need to find one
            }
        }
    }
}

function insertStatusElement() {
    // Target the main player container
    const targetContainer = document.querySelector('.player-main-container');

    if (!targetContainer) {
        console.warn("Failed to find player main container!");
        return "fail";
    }

    // Remove existing status element if present
    const existingStatus = document.getElementById('chrip-status');
    if (existingStatus) {
        existingStatus.remove();
    }

    // Create and insert new status element with wrapper around it for more awareness
    const statusWrapper = document.createElement('div');
    statusWrapper.style.cssText = "display: flex; margin: auto";

    const statusEl = document.createElement('h1');
    statusEl.id = 'chrip-status';
    statusEl.style.color = 'white';
    statusEl.style.margin = '10px 0';
    statusEl.style.padding = '8px';
    statusEl.style.fontSize = '1.5rem';
    statusEl.style.border = '4px solid #e42251';
    statusEl.style.borderRadius = '4px';
    statusEl.textContent = '🐤.🪦 Initializing...';

    statusWrapper.appendChild(statusEl);
    targetContainer.appendChild(statusWrapper);

    return "success";
}

async function setStatus(text) {
    try {
        const statusEl = driver.findElement(By.id("chrip-status"))
        if (!statusEl) {
            console.warn('Status element not found, logging to console only');
            return
        }
        await driver.executeScript(`arguments[0].textContent = "🐤.🪦 ${text}"`, statusEl)
        console.log(text);
    } catch (err) {
        console.warn('Failed to update status element:', err.message);
        console.log(text);
    }
}

async function waitForPlayer() {
    let listingData = null;

    await resetToLibrary();

    console.log("Waiting for you to navigate to a book...");
    console.log("Please click on a book in your library to open it.");

    while (true) {
        // Wait for user to navigate to either a listing page or player page
        const currentPage = await getCurrentPage()
        if (!currentPage) {
            console.warn("Unrecognized URL. Will wait 2 seconds and try again...")
            await sleep(2000);
            continue;
        }

        if (currentPage === "library") {
            await sleep(2000);
            continue;
        }

        if (currentPage === "player") {
            console.log("Player loaded!");
            return listingData;
        }

        listingData = getAudiobookDataFromListing();

        try {
            const startListeningButtons = await driver.findElements(By.linkText('Start Listening'));
            if (startListeningButtons.length === 0) {
                console.log('Could not find play button to click');
                continue
            }

            await startListeningButtons[0].click();
            console.log('Automatically launching player from details page...');

            const originalHandle = await driver.getWindowHandle();

            const startTime = Date.now();
            while (Date.now() - startTime < 10_000) {
                const handles = await driver.getAllWindowHandles();

                // Look for a new handle that wasn't the original
                const newHandle = handles.find(h => h !== originalHandle);

                if (newHandle) {
                    console.log('New window/tab detected, switching to it...');
                    await driver.switchTo().window(newHandle);
                    break;
                }

                await sleep(500);
            }

            return listingData;
        } catch (e) {
            console.log('Could not click play button:', e.message);
        }
    }
}

async function attemptInsertStatus() {
    // Try to insert status element with retry logic
    const maxAttempts = 3;

    for (let attempts = 0; attempts < maxAttempts; attempts++) {
        const success = await driver.executeScript(`return (${insertStatusElement.toString()})() === "success"`);

        if (success) {
            console.log('Status element inserted successfully');
            await setStatus("! PLEASE WAIT !");
            return;
        }

        console.warn(`Attempt ${attempts}/${maxAttempts}: Could not find status element container`);
    }
}

async function main() {

    console.log("Ensuring Chrome for Testing is installed...");
    const { path: chromePath } = await install({
        browser: PuppeteerBrowser.CHROME,
        buildId: '142.0.7444.59',
        cacheDir: path.join(__dirname, '.browser-cache'),
    });
    console.log(`Using Chrome for Testing from: ${chromePath}`);

    const downloadDir = path.join(__dirname, '.downloads');
    if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir);
    }

    const opt = new chrome.Options();
    opt.setBinaryPath(chromePath);
    opt.addArguments("--disable-features=DisableLoadExtensionCommandLineSwitch");
    opt.addArguments(`--user-data-dir=${path.join(__dirname, ".user-data")}`);
    opt.addArguments(`--load-extension=${path.join(__dirname, "ext")}`);
    opt.addArguments("--disable-infobars");
    opt.setUserPreferences({
        'download.default_directory': downloadDir,
        'download.prompt_for_download': false,
        'download.directory_upgrade': true,
    });
    driver = new Builder()
        .forBrowser(Browser.CHROME)
        .setChromeOptions(opt)
        .build();

    try {
        // Ensure only one tab exists and navigate to homepage
        const handles = await driver.getAllWindowHandles();
        if (handles.length > 1) {
            console.log(`Closing ${handles.length - 1} extra tab(s)...`);
            // Keep the first tab, close the rest
            for (let i = 1; i < handles.length; i++) {
                await driver.switchTo().window(handles[i]);
                await driver.close();
            }
            await driver.switchTo().window(handles[0]);
        }

        // Always navigate to homepage to start fresh
        await driver.get('https://www.chirpbooks.com/home');
        await sleep(1000);

        await login(driver)

        const listingData = await waitForPlayer();

        console.log("On player page - proceeding with download setup")

        await attemptInsertStatus();

        // Wait for player elements to be ready
        driver.wait(until.elementLocated(By.css("#webplayer.initialized")), 60 * 1000)
        await sleep(3000)

        // Retrieve optional cookies with null checks
        const cfBmCookieObj = await driver.manage().getCookie('__cf_bm');
        const cfBmCookie = cfBmCookieObj ? cfBmCookieObj.value : null;
        if (!cfBmCookie) {
            console.log('__cf_bm cookie was not found and is being skipped');
        }

        const mjWpScrtCookieObj = await driver.manage().getCookie('mj_wp_scrt');
        const mjWpScrtCookie = mjWpScrtCookieObj ? mjWpScrtCookieObj.value : null;
        if (!mjWpScrtCookie) {
            console.log('mj_wp_scrt cookie was not found and is being skipped');
        }


        // Extract metadata - use listing data if available, otherwise fall back to DOM
        if (listingData) {
            console.log('Using metadata from listing page...');
        }

        credits = await getCredits(listingData);

        // Try to get title from listing data first, then fall back to DOM
        if (listingData && listingData.displayTitle) {
            title = listingData.displayTitle;
            console.log(`Title from listing: ${title}`);
        } else {
            title = await driver.findElement(By.className("book-title")).getText();
        }

        const dirname = filename(`${title} - ${credits}`);
        fs.mkdir(dirname, (err) => {
            if (err && err.code !== 'EEXIST') {
                throw err
            }
            console.log('Directory created successfully!');
        });

        // Pass cover URL from listing data if available
        await getCover(dirname, listingData ? listingData.coverUrl : null);

        const existingFiles = fs.existsSync(dirname) ? fs.readdirSync(dirname) : [];
        const trackNumbers = existingFiles
            .filter(f => f.endsWith('.m4a'))
            .map(f => {
                const match = f.match(/- (\d{4}) -/);
                return match ? parseInt(match[1], 10) : 0;
            });
        let count = trackNumbers.length > 0 ? Math.max(...trackNumbers) + 1 : 1;
        console.log(`Resuming from file ${count}`);

        await setStatus(getResumeStatusMessage(existingFiles, count));

        const urls = [];
        let moreChapters = true;
        while (moreChapters) {

            await sleep(1000)
            await driver.wait(until.elementLocated(By.id('audioUrl')), 100000)
            await setStatus("Downloading file " + count);
            const element = await driver.findElement(By.id('audioUrl'))
            const url = await element.getText()
            if (urls.includes(url))
                continue

            urls.push(url)

            // Pause playback while we work
            const pause = await driver.findElement(By.className("play-pause playing"))
            await pause.click();

            const clearDownloadDir = () => {
                const files = fs.readdirSync(downloadDir);
                for (const file of files) {
                    fs.unlinkSync(path.join(downloadDir, file));
                }
            };

            const waitForDownload = async (timeoutMs = 60000) => {
                const startTime = Date.now();
                let lastSize = 0;
                let stableCount = 0;

                while (Date.now() - startTime < timeoutMs) {
                    const files = fs.readdirSync(downloadDir);
                    const downloading = files.filter(f => f.endsWith('.crdownload') || f.endsWith('.tmp'));
                    const completed = files.filter(f => !f.endsWith('.crdownload') && !f.endsWith('.tmp'));

                    if (completed.length > 0) {
                        const filePath = path.join(downloadDir, completed[0]);
                        const currentSize = fs.statSync(filePath).size;

                        if (currentSize > 0 && currentSize === lastSize) {
                            stableCount++;
                            if (stableCount >= 3) {
                                return filePath;
                            }
                        } else {
                            lastSize = currentSize;
                            stableCount = 0;
                        }
                    } else if (downloading.length > 0) {
                        stableCount = 0;
                    }

                    await sleep(500);
                }
                return null;
            };

            clearDownloadDir();


            const originalWindow = await driver.getWindowHandle();
            await driver.switchTo().newWindow('tab');
            await driver.get(url);

            const downloadedFile = await waitForDownload(60000);

            if (!downloadedFile) {
                console.error('A download failed');
                console.error('Please rerun the script. Progress will be resumed from the last successful download.');
                await driver.close();
                await driver.switchTo().window(originalWindow);
                process.exit(1);
            }

            await driver.close();
            await driver.switchTo().window(originalWindow);
            await sleep(500);

            await setStatus("Waiting for 5 seconds to avoid rate limiting");

            // Pause for 5 seconds to avoid rate limiting
            await sleep(5000);


            const audioBuffer = fs.readFileSync(downloadedFile);
            console.log(`Downloaded ${path.basename(downloadedFile)}: ${audioBuffer.length} bytes`);


            chapter = await driver.findElement(By.className("chapter")).getText()

            let trackNum = count.toString().padStart(4, "0");
            let name = filename(`${title} - ${trackNum} - ${chapter}.m4a`);
            await writeFile(path.join(dirname, name), audioBuffer)
            count++;

            const btn = await driver.findElement(By.className("next-chapter"))
            const enabled = await btn.isEnabled()
            if (!enabled) {
                console.log('Download complete!');
                moreChapters = false;
                driver.close()
                break;
            } else {
                await btn.click()
            }

            // Resume playback
            const play = await driver.findElement(By.className("play-pause paused"))
            await play.click();
        }
    } catch (error) {
        console.error(error);
    } finally {
        if (driver) {
            await driver.quit()
        }
    }
}

main()
