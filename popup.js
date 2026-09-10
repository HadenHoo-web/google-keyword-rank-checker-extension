console.log("POPUP LOADED");

document.getElementById("btnCheck").onclick = () => {
    const keyword = document.getElementById("keyword").value.trim();
    const domain  = document.getElementById("domain").value.trim();

    if (!keyword || !domain) {
        alert("Nhập keyword và domain!");
        return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];

        chrome.runtime.sendMessage(
            {
                action: "CHECK_RANK",
                keyword,
                domain
            },
            (res) => console.log("POPUP RESULT:", res)
        );
    });
};



