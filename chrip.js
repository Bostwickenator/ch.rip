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

// Wait for and switch to a new window/tab that opens
async function waitForAndSwitchToNewWindow(originalHandle, timeoutMs = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        const handles = await driver.getAllWindowHandles();

        // Look for a new handle that wasn't the original
        const newHandle = handles.find(h => h !== originalHandle);

        if (newHandle) {
            console.log('New window/tab detected, switching to it...');
            await driver.switchTo().window(newHandle);
            return true;
        }

        await sleep(500);
    }

    return false;
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

// Check if we're on a player page
async function isPlayerPage() {
    try {
        const elements = await driver.findElements(By.id('webplayer'));
        return elements.length > 0;
    } catch (e) {
        return false;
    }
}

// Check if play button is visible and clickable
// Supports: player page button, card play button overlay, book detail "Start Listening" button
async function isPlayButtonVisible() {
    try {
        // Check for player page play button
        const playerButtons = await driver.findElements(By.css('.play-pause'));
        if (playerButtons.length > 0) return true;
        
        // Check for card play button overlay
        const cardPlayButtons = await driver.findElements(By.css('[data-testid="cover-image-play-arrow"]'));
        if (cardPlayButtons.length > 0) return true;
        
        // Check for book detail page "Start Listening" button
        const startListeningButtons = await driver.findElements(By.css('[data-testid="play-audiobook-button"]'));
        return startListeningButtons.length > 0;
    } catch (e) {
        return false;
    }
}

// Click the play button
async function clickPlayButton() {
    try {
        // Try player page play button first
        const playerButtons = await driver.findElements(By.css('.play-pause'));
        if (playerButtons.length > 0) {
            await playerButtons[0].click();
            console.log('Clicked player page play button');
            return true;
        }
        
        // Try card play button overlay
        const cardPlayButtons = await driver.findElements(By.css('[data-testid="cover-image-play-arrow"]'));
        if (cardPlayButtons.length > 0) {
            await cardPlayButtons[0].click();
            console.log('Clicked card play button overlay');
            return true;
        }
        
        // Try book detail page "Start Listening" button
        const startListeningButtons = await driver.findElements(By.css('[data-testid="play-audiobook-button"]'));
        if (startListeningButtons.length > 0) {
            await startListeningButtons[0].click();
            console.log('Clicked Start Listening button');
            return true;
        }
        
        console.log('Could not find play button to click');
        return false;
    } catch (e) {
        console.log('Could not click play button:', e.message);
        return false;
    }
}

// Wait for play button to be clickable
async function waitForPlayButton(timeoutMs = 30000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        if (await isPlayButtonVisible()) {
            return true;
        }
        await sleep(500);
    }

    return false;
}

// Check if we're on a listing/book page
async function isListingPage() {
    try {
        const elements = await driver.findElements(By.css('[data-audiobook]'));
        return elements.length > 0;
    } catch (e) {
        return false;
    }
}

// Check if we're on a book detail page (separate from player page)
async function isBookDetailPage() {
    const currentUrl = await driver.getCurrentUrl();
    // Book detail pages have /audiobooks/ in URL but no webplayer
    return currentUrl.includes('/audiobooks/') && !(await isPlayerPage());
}

// Navigate to player from listing page by clicking the book
async function navigateToPlayerFromListing(listingData = null) {
    console.log('On listing page, navigating to player...');

    // Store original window handle to detect new tabs
    const originalHandle = await driver.getWindowHandle();
    console.log('Stored original window handle');

    // Try clicking approach - prefer play button overlay, then cover, then card
    let clickSucceeded = false;
    
    // First try clicking the play button overlay (opens player directly)
    try {
        const playButtonOverlay = await driver.findElement(By.css('[data-testid="cover-image-play-arrow"]'));
        await playButtonOverlay.click();
        console.log('Clicked play button overlay');
        clickSucceeded = true;
        
        // Wait for player to open in new tab
        console.log('Waiting for player to open in new tab...');
        const newWindowOpened = await waitForAndSwitchToNewWindow(originalHandle, 5000);
        
        if (!newWindowOpened) {
            console.log('No new tab detected, checking if player opened in same tab...');
        }
    } catch (e) {
        console.log('Could not click play button overlay, trying cover/card...');
    }
    
    // If play button didn't work, try clicking the cover or card
    if (!clickSucceeded) {
        const clickSelectors = [
            { selector: By.css('[data-testid="cover-image-container"]'), name: 'cover container' },
            { selector: By.css('[data-testid="user-audiobook-card"]'), name: 'audiobook card' },
            { selector: By.className('cover-image'), name: 'cover image' }
        ];

        for (const { selector, name } of clickSelectors) {
            try {
                const element = await driver.findElement(selector);
                await element.click();
                console.log('Clicked ' + name + ' to navigate to player');
                clickSucceeded = true;

                // Wait for navigation - could be new tab or same tab
                console.log('Waiting for navigation...');
                await sleep(3000);
                
                // Check if we opened a new tab
                const newWindowOpened = await waitForAndSwitchToNewWindow(originalHandle, 3000);
                if (newWindowOpened) {
                    console.log('New tab detected, switched to it');
                } else {
                    console.log('Navigation stayed in same tab');
                }

                break;
            } catch (e) {
                console.log('Could not click ' + name + ', trying next option...');
            }
        }
    }

    // If clicking failed and we have listing data with URL, use direct navigation
    if (!clickSucceeded && listingData && listingData.url) {
        try {
            const baseUrl = 'https://www.chirpbooks.com';
            const playerUrl = baseUrl + listingData.url;
            console.log('Click navigation failed, using direct URL: ' + playerUrl);
            await driver.get(playerUrl);
        } catch (e) {
            console.error('Failed to navigate using listing URL:', e.message);
            throw new Error('Could not navigate to player page');
        }
    }

    // Wait for navigation to complete
    console.log('Waiting for page to load...');
    await sleep(3000);

    // Check if we're on book detail page (need to click play button)
    if (await isBookDetailPage()) {
        console.log('On book detail page, looking for play button...');
        if (await waitForPlayButton(30000)) {
            const playClicked = await clickPlayButton();
            if (playClicked) {
                console.log('Clicked play button on book detail page');
                await sleep(3000);
                // Wait for player to load in new tab
                await waitForAndSwitchToNewWindow(await driver.getWindowHandle(), 5000);
            }
        }
    }

    // Wait for the player to be initialized
    await driver.wait(async () => {
        return await isPlayerPage();
    }, 30000);

    console.log('Player page loaded');
    await sleep(2000);
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

function insertStatusElement() {
    // Target the main audiobook card container directly
    const targetContainer = document.querySelector('[data-testid="user-audiobook-card"]');

    if (!targetContainer) {
        console.error('STATUS: Could not find book info container');
        console.error('Expected selector: [data-testid="user-audiobook-card"]');
        console.warn('Page may have an unexpected layout. Try refreshing or manually clicking the book.');
        return { success: false, error: 'DOM_MISMATCH', triedSelectors: ['[data-testid="user-audiobook-card"]'] };
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
}

// Convert function to string for Selenium execution
const insertStatusElementString = insertStatusElement.toString();

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

async function main() {

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


            console.log("Waiting for you to navigate to a book...");
            console.log("Please click on a book in your library to open it.");

            // Wait for user to navigate to either a listing page or player page
            let onCorrectPage = false;
            let listingData = null;

            while (!onCorrectPage) {
                await sleep(2000);

                // Check if we're on player page
                if (await isPlayerPage()) {
                    console.log('Detected player page');
                    onCorrectPage = true;
                    break;
                }

                // Check if we're on book detail page (need to click play button)
                if (await isBookDetailPage()) {
                    console.log('Detected book detail page, looking for play button...');
                    
                    // Wait for and click play button on book detail page
                    if (await waitForPlayButton(30000)) {
                        const playClicked = await clickPlayButton();
                        if (playClicked) {
                            console.log('Clicked play button on book detail page');
                            // Wait for player to load in new tab
                            await sleep(3000);
                            // Check if player page loaded
                            if (await isPlayerPage()) {
                                console.log('Player page loaded after clicking play');
                                onCorrectPage = true;
                                break;
                            }
                        }
                    }
                    console.warn('Could not click play button on book detail page, will retry...');
                }

                // Check if we're on listing page
                if (await isListingPage()) {
                    console.log('Detected listing page, extracting metadata...');
                    listingData = await getAudiobookDataFromListing();
                    if (listingData) {
                        console.log(`Book: ${listingData.displayTitle} by ${listingData.displayAuthors}`);
                    }
                    // Navigate to player page
                    await navigateToPlayerFromListing(listingData);
                    onCorrectPage = true;
                    break;
                }

                // Check if URL indicates we're on a player or book page
                const currentUrl = await driver.getCurrentUrl();
                if (currentUrl.includes('/audiobooks/') || currentUrl.includes('player')) {
                    console.log('Detected potential book/player page via URL');
                    await sleep(3000); // Give it time to fully load

                    // Re-check page type after wait
                    if (await isPlayerPage()) {
                        console.log('Confirmed player page after wait');
                        onCorrectPage = true;
                        break;
                    }
                    if (await isBookDetailPage()) {
                        console.log('Confirmed book detail page after wait, looking for play button...');
                        if (await waitForPlayButton(30000)) {
                            const playClicked = await clickPlayButton();
                            if (playClicked) {
                                console.log('Clicked play button on book detail page');
                                await sleep(3000);
                                if (await isPlayerPage()) {
                                    console.log('Player page loaded after clicking play');
                                    onCorrectPage = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (await isListingPage()) {
                        console.log('Confirmed listing page after wait');
                        listingData = await getAudiobookDataFromListing();
                        await navigateToPlayerFromListing(listingData);
                        onCorrectPage = true;
                        break;
                    }
                }
            }

            console.log("On player page - proceeding with download setup")

            // Try to insert status element with retry logic
            let statusInserted = false;
            let attempts = 0;
            const maxAttempts = 3;

            while (!statusInserted && attempts < maxAttempts) {
                attempts++;
                const result = await driver.executeScript('return ' + insertStatusElementString);

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

            // Wait for player elements to be ready
            await driver.wait(until.elementLocated(By.css("#webplayer.initialized")), 60 * 1000)
            await sleep(3000)


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
}

main()
