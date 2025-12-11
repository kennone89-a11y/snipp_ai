// Enkel replay-logik för Marvel-panelerna
document.addEventListener("DOMContentLoaded", () => {
  const replayBtn = document.getElementById("replay-btn");
  const panelStrip = document.querySelector(".panel-strip");

  // Om vi inte är på rätt sida, gör ingenting
  if (!replayBtn || !panelStrip) return;

  replayBtn.addEventListener("click", () => {
    // Nollställ CSS-animationen
    panelStrip.style.animation = "none";

    // Tvinga layout (hack för att browsern ska "glömma" animationen)
    // eslint-disable-next-line no-unused-expressions
    panelStrip.offsetWidth;

    // Starta animationen igen
    panelStrip.style.animation = "slide-panels 2s ease-in-out forwards";
  });
});
 
// === Kenai Marvel-intro: replay-knapp på startsidan ===
document.addEventListener("DOMContentLoaded", () => {
  const replayBtn = document.getElementById("replay-btn");
  const panelStrip = document.querySelector(".panel-strip");

  // Om vi inte är på startsidan (ingen knapp/panel), gör inget
  if (!replayBtn || !panelStrip) return;

  replayBtn.addEventListener("click", () => {
    // Nollställ CSS-animationen
    panelStrip.style.animation = "none";

    // Tvinga layout (så att browsern "glömmer" animationen)
    // eslint-disable-next-line no-unused-expressions
    panelStrip.offsetWidth;

    // Starta animationen igen
    panelStrip.style.animation = "slide-panels 2s ease-in-out forwards";
  });
});

// === Kenai Marvel-intro: ladda upp bilder till panelerna ===
document.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("panelFiles");
  const panels = Array.from(document.querySelectorAll(".panel-strip .panel"));

  if (!fileInput || panels.length === 0) return;

  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files || []).slice(0, 4);

    // Rensa ev. gamla bilder
    panels.forEach((panel) => {
      panel.style.backgroundImage = "";
      panel.classList.remove("has-image");
    });

    // Sätt nya bilder
    files.forEach((file, index) => {
      const panel = panels[index];
      if (!panel) return;

      const url = URL.createObjectURL(file);
      panel.style.backgroundImage = `url("${url}")`;
      panel.classList.add("has-image");
    });
  });
});



