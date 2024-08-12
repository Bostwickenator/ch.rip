// Copyright 2023 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Provides credentials when an HTTP Basic Auth request is received.
audioUrls = []

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    console.log(details);
   if (details.url.includes(".m4a") || details.url.includes(".mp3")) {
      console.warn("An audio file!");
      if(!audioUrls.includes(details.url)){
        audioUrls.push(details.url);
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs){
          chrome.tabs.sendMessage(tabs[0].id, details);
        });
    }
  }},
  { urls: ["<all_urls>"] },
  ['extraHeaders']
);
