(function () {
  "use strict";

  var STORAGE_EMAIL_KEY = "rh_last_delivery_email";

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  function qsa(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  /* Copy to clipboard (payment page) */
  qsa(".js-copy").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var id = btn.getAttribute("data-copy-target");
      var label = btn.getAttribute("data-copy-label") || "Value";
      var el = id ? document.getElementById(id) : null;
      var text = el ? el.textContent.trim() : "";
      if (!text) return;

      function showToast(msg) {
        var existing = qs(".rh-toast");
        if (existing) existing.remove();
        var t = document.createElement("div");
        t.className = "rh-toast rh-toast--show";
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(function () {
          t.classList.remove("rh-toast--show");
          setTimeout(function () {
            t.remove();
          }, 300);
        }, 2200);
      }

      function done(ok) {
        showToast(ok ? label + " copied" : "Could not copy");
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          done(true);
        }).catch(function () {
          done(false);
        });
      } else {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
          done(true);
        } catch (e) {
          done(false);
        }
        document.body.removeChild(ta);
      }
    });
  });

  /* Shop category filtering */
  var filterWrap = qs("#rh-category-filter");
  if (filterWrap) {
    var filterButtons = qsa(".js-shop-filter");
    var shopItems = qsa(".rh-shop-item");

    function applyFilter(category) {
      shopItems.forEach(function (item) {
        var cat = item.getAttribute("data-category") || "";
        var show = category === "all" || cat === category;
        item.style.display = show ? "" : "none";
      });
    }

    filterButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var category = btn.getAttribute("data-category") || "all";
        filterButtons.forEach(function (b) {
          b.classList.remove("is-active");
        });
        btn.classList.add("is-active");
        applyFilter(category);
      });
    });
  }

  /* Product modal + email API */
  var overlay = qs("#product-modal");
  if (!overlay) return;

  var form = qs("#email-delivery-form");
  var productIdInput = qs("#modal-product-id");
  var productNameInput = qs("#modal-product-name");
  var productLabel = qs(".js-modal-product-label");
  var feedback = qs("#modal-feedback");
  var submitBtn = qs("#modal-submit");
  var afterSuccess = qs("#modal-after-success");
  var productShortEl = qs(".js-modal-product-short");

  function setFeedback(ok, message) {
    if (!feedback) return;
    feedback.hidden = false;
    feedback.textContent = message;
    feedback.className =
      "rh-modal-feedback " + (ok ? "rh-modal-feedback--ok" : "rh-modal-feedback--err");
  }

  function clearFeedback() {
    if (!feedback) return;
    feedback.hidden = true;
    feedback.textContent = "";
    feedback.className = "rh-modal-feedback";
  }

  function showAfterSuccess(show) {
    if (!afterSuccess) return;
    afterSuccess.hidden = !show;
  }

  function openModal(productId, productName) {
    clearFeedback();
    showAfterSuccess(false);
    if (productIdInput) productIdInput.value = productId || "";
    if (productNameInput) productNameInput.value = productName || "";
    if (productLabel) {
      productLabel.textContent = "Sending: " + (productName || "");
    }
    if (productShortEl) {
      productShortEl.textContent = productName ? "“" + productName + "”" : "this item";
    }
    var emailField = qs("#delivery-email");
    if (emailField) {
      emailField.value = "";
      try {
        var remembered = sessionStorage.getItem(STORAGE_EMAIL_KEY);
        if (remembered) emailField.value = remembered;
      } catch (e) {}
    }
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    if (emailField) {
      setTimeout(function () {
        emailField.focus();
        if (emailField.value) emailField.select();
      }, 50);
    }
  }

  function closeModal() {
    overlay.hidden = true;
    document.body.style.overflow = "";
    clearFeedback();
    showAfterSuccess(false);
  }

  qsa(".js-open-modal").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var id = btn.getAttribute("data-product-id") || "";
      var name = btn.getAttribute("data-product-name") || "";
      openModal(id, name);
    });
  });

  qsa(".js-close-modal").forEach(function (b) {
    b.addEventListener("click", closeModal);
  });

  qsa(".js-owned-help").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var msg =
        btn.getAttribute("data-reset-message") ||
        "Already sent. Contact us on Instagram @cjay.resells to reset email usage.";
      window.alert(msg);
    });
  });

  var btnSameAgain = qs(".js-modal-same-again");
  if (btnSameAgain) {
    btnSameAgain.addEventListener("click", function () {
      clearFeedback();
      showAfterSuccess(false);
      var emailField = qs("#delivery-email");
      if (emailField) {
        emailField.value = "";
        emailField.focus();
      }
    });
  }

  var btnPickOther = qs(".js-modal-pick-other");
  if (btnPickOther) {
    btnPickOther.addEventListener("click", closeModal);
  }

  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closeModal();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && overlay && !overlay.hidden) closeModal();
  });

  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      clearFeedback();
      showAfterSuccess(false);

      var email = qs("#delivery-email");
      var pid = productIdInput ? productIdInput.value.trim() : "";
      var addr = email ? email.value.trim() : "";

      if (!addr || !pid) {
        setFeedback(false, "Please fill in all fields.");
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Sending…";
      }

      fetch("/api/send-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: addr, productId: pid }),
      })
        .then(function (res) {
          return res.text().then(function (text) {
            var data = {};
            try {
              data = text ? JSON.parse(text) : {};
            } catch (err) {
              data = { message: text || "Invalid response" };
            }
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          var d = result.data || {};
          if (result.ok && d.ok) {
            setFeedback(true, d.message || "Sent successfully.");
            try {
              sessionStorage.setItem(STORAGE_EMAIL_KEY, addr);
            } catch (err2) {}
            if (email) email.value = "";
            showAfterSuccess(true);
          } else {
            setFeedback(false, d.message || "Something went wrong.");
          }
        })
        .catch(function () {
          setFeedback(false, "Network error. Try again.");
        })
        .finally(function () {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Send to my inbox";
          }
        });
    });
  }
})();
