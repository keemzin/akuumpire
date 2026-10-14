/**
 * Modern Custom Dropdown Component for ShuttleLive
 * Converts native <select class="custom-select"> into a custom dark-mode dropdown
 * while keeping native <select> synchronized for forms, validation, and change events.
 */

export function setupCustomSelect(selectEl) {
  if (!selectEl) return null;

  // If already customized, just trigger a refresh
  if (selectEl.dataset.customized === "true") {
    selectEl.dispatchEvent(new Event("sync"));
    return null;
  }

  selectEl.dataset.customized = "true";
  selectEl.classList.add("custom-select-hidden");

  // Create wrapper
  const wrapper = document.createElement("div");
  wrapper.className = "custom-select-wrapper";
  selectEl.parentNode.insertBefore(wrapper, selectEl);
  wrapper.appendChild(selectEl);

  // Trigger button
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "custom-select-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  const labelSpan = document.createElement("span");
  labelSpan.className = "custom-select-label";

  const arrowSpan = document.createElement("span");
  arrowSpan.className = "custom-select-arrow";
  arrowSpan.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  `;

  trigger.appendChild(labelSpan);
  trigger.appendChild(arrowSpan);
  wrapper.appendChild(trigger);

  // Menu listbox
  const menu = document.createElement("div");
  menu.className = "custom-select-menu";
  menu.setAttribute("role", "listbox");
  wrapper.appendChild(menu);

  function syncOptions() {
    menu.innerHTML = "";
    const options = Array.from(selectEl.options);
    const selectedOption = selectEl.options[selectEl.selectedIndex] || options[0];

    labelSpan.textContent = selectedOption ? selectedOption.textContent : "Select...";

    options.forEach((opt) => {
      const isSelected = opt.value === selectEl.value;
      const item = document.createElement("div");
      item.className = "custom-select-option" + (isSelected ? " selected" : "");
      item.setAttribute("role", "option");
      item.setAttribute("data-value", opt.value);
      item.setAttribute("tabindex", "0");

      const optText = document.createElement("span");
      optText.className = "option-label";
      optText.textContent = opt.textContent;

      const optCheck = document.createElement("span");
      optCheck.className = "option-check";
      optCheck.textContent = "✓";

      item.appendChild(optText);
      item.appendChild(optCheck);

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        selectOption(opt.value);
        closeMenu();
      });

      menu.appendChild(item);
    });
  }

  function selectOption(val) {
    if (selectEl.value === val) return;
    selectEl.value = val;
    selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    syncOptions();
  }

  function toggleMenu() {
    if (wrapper.classList.contains("open")) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  function openMenu() {
    document.querySelectorAll(".custom-select-wrapper.open").forEach(w => {
      if (w !== wrapper) {
        w.classList.remove("open");
        const t = w.querySelector(".custom-select-trigger");
        if (t) t.setAttribute("aria-expanded", "false");
      }
    });

    wrapper.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
  }

  function closeMenu() {
    wrapper.classList.remove("open");
    trigger.setAttribute("aria-expanded", "false");
  }

  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleMenu();
  });

  selectEl.addEventListener("sync", () => {
    syncOptions();
  });

  syncOptions();

  return {
    sync: syncOptions,
    close: closeMenu
  };
}

export function refreshCustomSelect(selectEl) {
  if (!selectEl) return;
  selectEl.dispatchEvent(new Event("sync"));
}

// Global click outside to close any open dropdowns
document.addEventListener("click", (e) => {
  if (!e.target.closest(".custom-select-wrapper")) {
    document.querySelectorAll(".custom-select-wrapper.open").forEach(w => {
      w.classList.remove("open");
      const t = w.querySelector(".custom-select-trigger");
      if (t) t.setAttribute("aria-expanded", "false");
    });
  }
});

// Global Escape key to close
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".custom-select-wrapper.open").forEach(w => {
      w.classList.remove("open");
      const t = w.querySelector(".custom-select-trigger");
      if (t) t.setAttribute("aria-expanded", "false");
    });
  }
});
