console.log("PAGE SCRIPT LOADED");
window.__BUFFSEO_EXT__ = true;

window.addEventListener("message", (event) => {
    if (!event.data) return;

    if (event.data.action === "CHECK_RANK" ||
        event.data.action === "TEST_CONNECT") {
        window.postMessage(
            { __BUFFSEO_FORWARD: event.data },
            "*"
        );
    }
    if (event.data.action === "CHECK_RANK") {
        console.log("PAGE → EXT:", event.data);
    }
});

