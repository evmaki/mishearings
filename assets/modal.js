// lightweight script for implementing bootstrap-like modal components
function showModal(selector) {
    hideModals();
    document.querySelector(selector).style.setProperty("display", "block");
    document
        .querySelector("#modalOverlay")
        .style.setProperty("display", "block");
}

function hideModals() {
    document.querySelectorAll(".modal").forEach((element) => {
        element.style.setProperty("display", "none");
    });
    document
        .querySelector("#modalOverlay")
        .style.setProperty("display", "none");
}

document.querySelector("#modalOverlay").addEventListener("click", hideModals);

document.querySelectorAll("[data-modal-target]").forEach((element) => {
    var target = element.getAttribute("data-modal-target")
    element.addEventListener("click", () => {
        showModal(target)
    })
})

document.querySelectorAll("[data-modal-dismiss]").forEach((element) => {
    element.addEventListener("click", () => {
        hideModals()
    })
})