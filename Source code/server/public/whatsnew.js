// "What's new" pop-up: shown once on each device after the website moves to a
// new version. Every release needs an entry here, in all three languages
// (publish-update.js refuses to publish without one). Written by hand, not by
// Google Translate, so the pop-up is marked "notranslate".
// Newest first. Keep it to 2-4 short lines a person reads in ten seconds.
var WHATS_NEW = {
  "4.2.18": {
    en: {
      title: "What's new in PrintBridge",
      items: [
        "Double-sided printing now works on printers like the Canon LBP6230.",
        "On printers that can't turn the paper over by themselves, choose “Double-sided (you turn the paper over)”: the fronts print, PrintBridge shows how to turn the stack over, then the backs print.",
        "Each printer now shows whether it prints both sides by itself, by hand, or one side only.",
        "If PrintBridge was switched off in Windows Startup apps, it now starts anyway and explains how to switch it back on.",
      ],
      ok: "Got it",
    },
    si: {
      title: "PrintBridge හි අලුත් දේ",
      items: [
        "Canon LBP6230 වැනි මුද්‍රණ යන්ත්‍රවල දෙපැත්තේ මුද්‍රණය දැන් නිවැරදිව ක්‍රියා කරයි.",
        "කඩදාසිය තනිවම පෙරළිය නොහැකි යන්ත්‍රවල, PrintBridge මුලින් ඉදිරිපස පිටු මුද්‍රණය කර, කඩදාසි පෙරළන ආකාරය පෙන්වා, පසුව පිටුපස පිටු මුද්‍රණය කරයි.",
        "සෑම මුද්‍රණ යන්ත්‍රයක්ම දෙපැත්තේ මුද්‍රණය තනිවමද, අතින්ද, නැතහොත් එක් පැත්තක් පමණක්ද යන්න දැන් පෙන්වයි.",
        "Windows Startup apps හි PrintBridge අක්‍රිය කර ඇත්නම්, එය දැන් ආරම්භ වී නැවත සක්‍රිය කරන ආකාරය පවසයි.",
      ],
      ok: "හරි",
    },
    ta: {
      title: "PrintBridge-இல் புதியவை",
      items: [
        "Canon LBP6230 போன்ற அச்சுப்பொறிகளில் இருபக்க அச்சிடல் இப்போது சரியாக வேலை செய்கிறது.",
        "தாளைத் தானாகத் திருப்ப முடியாத அச்சுப்பொறிகளில், PrintBridge முதலில் முன்பக்கங்களை அச்சிட்டு, தாள்களை எப்படித் திருப்புவது என்று காட்டி, பின்னர் பின்பக்கங்களை அச்சிடும்.",
        "ஒவ்வொரு அச்சுப்பொறியும் இருபக்கமும் தானாகவா, கையாலா, அல்லது ஒரு பக்கம் மட்டுமா என்பதை இப்போது காட்டுகிறது.",
        "Windows Startup apps-இல் PrintBridge அணைக்கப்பட்டிருந்தால், அது இப்போது தானாகத் தொடங்கி, மீண்டும் இயக்குவது எப்படி என்று சொல்லும்.",
      ],
      ok: "சரி",
    },
  },
  "4.2.17": {
    en: {
      title: "What's new in PrintBridge",
      items: [
        "Keep files in your bucket and print them all together later. Press “Add to bucket” on the print screen.",
        "After you press Print, you have 7 seconds to cancel or change it, or press “Print now”.",
        "Printouts waiting more than an hour are removed automatically, so nothing old prints by surprise.",
      ],
      ok: "Got it",
    },
    si: {
      title: "PrintBridge හි අලුත් දේ",
      items: [
        "ගොනු කිහිපයක් ඔබේ “bucket” එකට දමා, පසුව සියල්ල එකවර මුද්‍රණය කළ හැක.",
        "මුද්‍රණය ඔබූ පසු, එය අවලංගු කිරීමට හෝ වෙනස් කිරීමට තත්පර 7ක් ලැබේ. වහාම මුද්‍රණය කිරීමටද හැක.",
        "පැයකට වඩා රැදී සිටින මුද්‍රණ ස්වයංක්‍රීයව ඉවත් වේ. එබැවින් පැරණි දේ අනපේක්ෂිතව මුද්‍රණය නොවේ.",
      ],
      ok: "හරි",
    },
    ta: {
      title: "PrintBridge-இல் புதியவை",
      items: [
        "பல கோப்புகளை உங்கள் “bucket”-இல் சேர்த்து, பின்னர் அனைத்தையும் ஒன்றாக அச்சிடலாம்.",
        "அச்சிடு என்பதை அழுத்திய பின், ரத்து செய்ய அல்லது மாற்ற 7 விநாடிகள் உள்ளன. உடனே அச்சிடவும் முடியும்.",
        "ஒரு மணி நேரத்திற்கு மேல் காத்திருக்கும் அச்சுகள் தானாக நீக்கப்படும், எனவே பழையவை எதிர்பாராமல் அச்சாகாது.",
      ],
      ok: "சரி",
    },
  },
};

// Shows the notes for this version once per device. First-time visitors
// skip it (everything is new to them) but are marked as having seen it.
function showWhatsNew(version, force) {
  var SEEN = "printbridge-seen-version";
  var notes = WHATS_NEW[version];
  var seen = null, firstVisit = false;
  try { seen = localStorage.getItem(SEEN); firstVisit = !localStorage.getItem("printer-assist-name"); } catch (e) {}
  if (!force && (!notes || seen === version)) return;
  try { localStorage.setItem(SEEN, version); } catch (e) {}
  if (!notes || (firstVisit && !force)) return;

  var lang = "en";
  try { lang = localStorage.getItem("printbridge-language") || "en"; } catch (e) {}
  if (!notes[lang]) lang = "en";

  var modal = document.getElementById("whatsNewModal");
  function render() {
    var n = notes[lang];
    document.getElementById("whatsNewTitle").textContent = n.title;
    var list = document.getElementById("whatsNewList");
    list.innerHTML = "";
    n.items.forEach(function (text) { var li = document.createElement("li"); li.textContent = text; list.appendChild(li); });
    document.getElementById("whatsNewOk").textContent = n.ok;
    Array.prototype.forEach.call(modal.querySelectorAll("[data-lang]"), function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-lang") === lang));
    });
  }
  Array.prototype.forEach.call(modal.querySelectorAll("[data-lang]"), function (b) {
    b.onclick = function () { lang = b.getAttribute("data-lang"); render(); };
  });
  document.getElementById("whatsNewOk").onclick = function () { modal.hidden = true; };
  render();
  modal.hidden = false;
  document.getElementById("whatsNewOk").focus();
}
