const { Builder, Browser, By, Key, until } = require('selenium-webdriver')
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
                return `Ready! Navigate to chapter after "${prevChapterName}" and hit play`;
            }
        }
    }
    return `Ready! Navigate to chapter ${count} and hit play`;
}

async function getCover(dirname) {

    src = await driver.findElement(By.className("cover-image")).getAttribute('src')
    const response = await fetch(src)
    const body = Readable.fromWeb(response.body)
    await writeFile(path.join(dirname, 'cover.jpg'), body)

}

async function getCredits() {
    const credits = await driver.findElements(By.className("credit"))
    cred = ""
    for (let i = 0; i < credits.length; i++) {
        cred += cred.length != 0 ? ' - ' : '';
        cred += await credits[i].getText()
    }
    return filename(cred)
}

async function login() {
    await driver.get('https://www.chirpbooks.com/users/sign_in')
    await driver.wait(until.titleContains('Sign'), 1000)

    await driver.executeScript('document.querySelector("h1").textContent="Please sign-in to continue script"');

    await driver.wait(until.titleContains('Home'), 60 * 1000)
    await sleep(1000)
}

function extractChTrckCookie(cookieBundle) {
    // Split the cookie bundle into individual cookie strings
    const cookies = cookieBundle.split('; ');
    // Find the cookie string starting with "ch_trck="
    const chTrckCookie = cookies.find(cookie => cookie.startsWith('ch_trck='));

    if (chTrckCookie) {
        // Extract the encoded value after "ch_trck="
        const encodedValue = chTrckCookie.split('=')[1];

        return encodedValue;
    } else {
        console.error(JSON.stringify(cookies));
        throw new Error("Cannot find cookie");
    }
}

async function resetToLibrary() {

    let allTabs = await driver.getAllWindowHandles();
    for (let tab of allTabs) {
        await driver.switchTo().window(tab); // Switch to the current tab
        break;
    }

    await driver.get('https://www.chirpbooks.com/library')
    while ((await driver.getTitle()).includes("My Library")) {
        await sleep(1000)
        let allTabs = await driver.getAllWindowHandles();
        for (let tab of allTabs) {
            await driver.switchTo().window(tab); // Switch to the current tab
            // Check matching criteria (replace with your actual conditions)
            let url = await driver.getCurrentUrl();
            if (url.includes('player')) { // Example: Matching by title
                console.log("Found matching tab:", url);
                break; // Exit loop if you only need to find one
            }
        }
    }
}

const insertStatusElement = `
    (function() {
        // Try multiple selectors for compatibility with old and new website layouts
        const possibleSelectors = [
            '#webplayer > div.player-main-container > div.player-book-info > div.book-info',
            '.player-book-info .book-info',
            '[data-testid="user-audiobook-card"]'
        ];
        
        let targetContainer = null;
        for (const selector of possibleSelectors) {
            targetContainer = document.querySelector(selector);
            if (targetContainer) break;
        }
        
        if (!targetContainer) {
            console.error('STATUS: Could not find book info container');
            console.error('Expected one of these selectors:', possibleSelectors.join(', '));
            console.warn('Page may have an unexpected layout. Try refreshing or manually clicking the book.');
            return { success: false, error: 'DOM_MISMATCH', triedSelectors: possibleSelectors };
        }
        
        // Remove existing status element if present
        const existingStatus = document.getElementById('status');
        if (existingStatus) {
            existingStatus.remove();
        }
        
        // Create and insert new status element
        const statusEl = document.createElement('h1');
        statusEl.id = 'status';
        statusEl.style.cssText = 'color: white; margin: 10px 0; font-size: 1.2em;';
        statusEl.textContent = 'status: initializing...';
        
        targetContainer.appendChild(statusEl);
        return true;
    })()
`

async function setStatus(text) {
    try {
        const result = await driver.executeScript(`
            const el = document.getElementById('status');
            if (el) {
                el.textContent = "status: " + ${JSON.stringify(text)};
                return true;
            }
            return false;
        `);
        if (!result) {
            console.warn('Status element not found, logging to console only');
        }
        console.log(text);
    } catch (err) {
        console.warn('Failed to update status element:', err.message);
        console.log(text);
    }
}

; (async function example() {

    console.log("Ensuring Chrome for Testing is installed.");
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
    
    let opt = new chrome.Options();
    opt.setBinaryPath(chromePath);
    opt.addArguments("--disable-features=DisableLoadExtensionCommandLineSwitch");
    opt.addArguments("--load-extension=" + path.join(__dirname, "ext"));
    opt.setUserPreferences({
        'download.default_directory': downloadDir,
        'download.prompt_for_download': false,
        'download.directory_upgrade': true,
    });
    driver = await new Builder().forBrowser(Browser.CHROME).setChromeOptions(opt).build()
    try {
        await login(driver)

        while (true) {
            await resetToLibrary()


            console.log("On a book page")
            
            // Try to insert status element with retry logic
            let statusInserted = false;
            let attempts = 0;
            const maxAttempts = 3;
            
            while (!statusInserted && attempts < maxAttempts) {
                attempts++;
                const result = await driver.executeScript('return ' + insertStatusElement);
                
                if (result === true) {
                    statusInserted = true;
                    console.log('Status element inserted successfully');
                } else if (result && result.success === false) {
                    console.warn(`Attempt ${attempts}/${maxAttempts}: Could not find status element container`);
                    console.warn('Tried selectors:', result.triedSelectors.join(', '));
                    
                    if (attempts < maxAttempts) {
                        console.log('Waiting 5 seconds before retry...');
                        await sleep(5000);
                    } else {
                        console.error('Max attempts reached. Page may have unexpected layout.');
                        console.log('You can:');
                        console.log('  1. Navigate to the book manually in the browser');
                        console.log('  2. Refresh the page and wait for it to load');
                        console.log('  3. Press Ctrl+C to exit and restart the script');
                        console.log('Press Enter in this terminal to retry, or Ctrl+C to exit...');
                        await new Promise(resolve => process.stdin.once('data', resolve));
                        attempts = 0; // Reset attempts for another try
                    }
                }
            }
            
            if (statusInserted) {
                await setStatus("!PLEASE WAIT!");
            }
            await driver.wait(until.elementLocated(By.className("book-title")), 60 * 1000)
            await sleep(5000)


            const bundle = await driver.executeScript('return document.cookie')
            const chTrckCookie = extractChTrckCookie(bundle);
            
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


            credits = await getCredits()
            title = await driver.findElement(By.className("book-title")).getText()

            const dirname = filename(`${title} - ${credits}`);
            fs.mkdir(dirname, (err) => {
                if (err && err.code !== 'EEXIST') {
                    throw err
                }
                console.log('Directory created successfully!');
            });
                     
            await getCover(dirname);
            
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
            urls = [];
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
        }
    }
    catch (error) {
        console.error(error);
    }
    finally {
        if (driver) {
            await driver.quit()
        }
    }
})()
