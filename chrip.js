const { Builder, Browser, By, Key, until } = require('selenium-webdriver')
const chrome = require('selenium-webdriver/chrome');
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

const insertStatusElement = 'var s = document.querySelector("#webplayer > div.player-main-container > div.player-book-info > div.book-info").appendChild(document.createElement("h1")); s.id="status"; s.style="color:white;";'
const statusSelector = 'document.querySelector("#status")'

async function setStatus(text) {
    await driver.executeScript(`${statusSelector}.textContent="status: ${text}"`);
    console.log(text);
}

; (async function example() {

    let opt = new chrome.Options();
    opt.addArguments("--disable-features=DisableLoadExtensionCommandLineSwitch");
    opt.addArguments("--load-extension=" + __dirname + "/ext");
    driver = await new Builder().forBrowser(Browser.CHROME).setChromeOptions(opt).build()
    try {
        await login(driver)

        while (true) {
            await resetToLibrary()


            console.log("On a book page")
            await driver.executeScript(insertStatusElement);
            await setStatus("!PLEASE WAIT!");
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
            await setStatus("Ready! make sure you are on the first chapter and hit play");
            urls = [];
            let count = 1;
            let moreChapters = true;
            while (moreChapters) {

                await sleep(1000)
                await driver.wait(until.elementLocated(By.id('audioUrl')), 100000)
                await setStatus("Downloading chapter " + count);
                const element = await driver.findElement(By.id('audioUrl'))
                const url = await element.getText()
                if (urls.includes(url))
                    continue

                urls.push(url)

                // Build cookie header dynamically from available cookies
                const cookieParts = [];
                if (cfBmCookie) {
                    cookieParts.push(`__cf_bm=${cfBmCookie}`);
                }
                cookieParts.push(`ch_trck=${chTrckCookie}`);
                if (mjWpScrtCookie) {
                    cookieParts.push(`mj_wp_scrt=${mjWpScrtCookie}`);
                }
                const cookieHeader = cookieParts.join('; ');
                
                const response = await fetch(url, {
                    "headers": {
                        "accept": "*/*",
                        "accept-language": "en-US,en-GB;q=0.9,en;q=0.8",
                        "if-range": "\"02b735596ce7485b7f7fea0eb05e4eac\"",
                        "priority": "i",
                        "range": "bytes=0-",
                        "sec-ch-ua": "\"Not/A)Brand\";v=\"8\", \"Chromium\";v=\"126\", \"Google Chrome\";v=\"126\"",
                        "sec-ch-ua-mobile": "?0",
                        "sec-ch-ua-platform": "\"Windows\"",
                        "sec-fetch-dest": "audio",
                        "sec-fetch-mode": "no-cors",
                        "sec-fetch-site": "same-site",
                        "cookie": cookieHeader,
                        "Referer": "https://www.chirpbooks.com/",
                        "Referrer-Policy": "strict-origin-when-cross-origin"
                    },
                    "body": null,
                    "method": "GET"
                });
                const body = Readable.fromWeb(response.body)


                chapter = await driver.findElement(By.className("chapter")).getText()

                let trackNum = count.toString().padStart(4, "0");
                let name = filename(`${title} - ${trackNum} - ${chapter}.m4a`);
                await writeFile(path.join(dirname, name), body)
                count++;

                const btn = await driver.findElement(By.className("next-chapter"))
                const enabled = await btn.isEnabled()
                if (!enabled) {
                    moreChapters = false;
                    driver.close()
                    break;
                } else {
                    await btn.click()
                }
            }
        }
    }
    catch (error) {
        console.error(error);
    }
    finally {
        await driver.quit()
    }
})()
