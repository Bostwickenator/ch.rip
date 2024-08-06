console.log("frontend loaded")
chrome.runtime.onMessage.addListener(function(details) {
    console.log("frontend:"+ JSON.stringify(details))

    let script = document.getElementById("audioUrl")
    if(!script){
        script = document.createElement('p')
        script.id = "audioUrl"
    }
    script.innerText = details.url  
    document.documentElement.appendChild(script)
});