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

  /* Fullscreen image modal (quality photos lightbox) */
  var imgOverlay = qs("#rh-img-modal");
  if (imgOverlay) {
    var imgEl = qs("#rh-img-modal-img");
    var imgButtons = qsa(".js-img-modal-open");
    var imgList = imgButtons.map(function (btn) {
      return {
        idx: parseInt(btn.getAttribute("data-img-index") || "0", 10) || 0,
        url: btn.getAttribute("data-img-url") || "",
        alt: btn.getAttribute("data-img-alt") || "Quality photo",
      };
    });

    // Ensure imgList is sorted by the provided index.
    imgList.sort(function (a, b) {
      return a.idx - b.idx;
    });

    function setImageByIndex(nextIndex) {
      if (!imgList.length) return;
      var clamped = Math.max(0, Math.min(nextIndex, imgList.length - 1));
      var item = imgList[clamped];
      if (!item || !item.url) return;
      if (imgEl) {
        imgEl.src = item.url;
        imgEl.alt = item.alt;
      }
      imgOverlay.dataset.activeIndex = String(clamped);
    }

    function nextImage() {
      if (imgOverlay.hidden) return;
      var current = parseInt(imgOverlay.dataset.activeIndex || "0", 10) || 0;
      setImageByIndex(current + 1);
    }

    function prevImage() {
      if (imgOverlay.hidden) return;
      var current = parseInt(imgOverlay.dataset.activeIndex || "0", 10) || 0;
      setImageByIndex(current - 1);
    }

    qsa(".js-img-modal-open").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var url = btn.getAttribute("data-img-url") || "";
        var alt = btn.getAttribute("data-img-alt") || "Quality photo";
        var idx = parseInt(btn.getAttribute("data-img-index") || "0", 10) || 0;
        if (!url) return;
        if (imgEl) {
          imgEl.src = url;
          imgEl.alt = alt;
        }
        // Use the click index to select the correct item.
        // Since we sort by data-img-index, we find its position in imgList.
        var pos = 0;
        for (var i = 0; i < imgList.length; i++) {
          if (imgList[i] && imgList[i].idx === idx) {
            pos = i;
            break;
          }
        }
        imgOverlay.dataset.activeIndex = String(pos);
        imgOverlay.hidden = false;
        document.body.style.overflow = "hidden";
      });
    });

    qsa(".js-img-modal-close").forEach(function (b) {
      b.addEventListener("click", function () {
        imgOverlay.hidden = true;
        document.body.style.overflow = "";
      });
    });

    imgOverlay.addEventListener("click", function (e) {
      if (e.target === imgOverlay) {
        imgOverlay.hidden = true;
        document.body.style.overflow = "";
      }
    });

    // Keyboard navigation (desktop)
    document.addEventListener("keydown", function (e) {
      if (!imgOverlay || imgOverlay.hidden) return;
      if (e.key === "Escape") {
        imgOverlay.hidden = true;
        document.body.style.overflow = "";
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        nextImage();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prevImage();
        return;
      }
    });

    // Horizontal wheel / trackpad navigation
    imgOverlay.addEventListener(
      "wheel",
      function (e) {
        if (imgOverlay.hidden) return;
        var dx = e.deltaX || 0;
        var dy = e.deltaY || 0;
        // Prefer horizontal intent.
        if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) {
          e.preventDefault();
          if (dx > 0) nextImage();
          else prevImage();
        }
      },
      { passive: false }
    );

    // Touch swipe navigation (mobile)
    var touchStartX = null;
    var touchStartY = null;
    imgOverlay.addEventListener("touchstart", function (e) {
      if (imgOverlay.hidden) return;
      if (!e.touches || !e.touches.length) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    });
    imgOverlay.addEventListener("touchend", function (e) {
      if (imgOverlay.hidden) return;
      if (touchStartX === null || !e.changedTouches || !e.changedTouches.length) return;
      var dx = e.changedTouches[0].clientX - touchStartX;
      var dy = e.changedTouches[0].clientY - touchStartY;
      // Horizontal swipe
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        e.preventDefault();
        if (dx > 0) prevImage();
        else nextImage();
      }
      touchStartX = null;
      touchStartY = null;
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
