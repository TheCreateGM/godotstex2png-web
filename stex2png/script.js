// Theme Toggling Script (run immediately, before DOMContentLoaded for faster theme application)
(() => {
    const themeToggleBtn = document.getElementById("theme-toggle");
    const htmlElement = document.documentElement;
    const themeLocalStorageKey = "user-theme-preference";

    // Icons for the button
    const lightIcon = "☀️";
    const darkIcon = "🌙";

    /**
     * Applies the theme to the HTML element and updates the toggle button.
     * @param {'light' | 'dark'} theme - The theme to apply.
     */
    function applyTheme(theme) {
        htmlElement.dataset.theme = theme;
        themeToggleBtn.textContent =
            theme === "dark" ? lightIcon : darkIcon;
        themeToggleBtn.setAttribute(
            "aria-label",
            `Switch to ${theme === "dark" ? "light" : "dark"} mode`,
        );
    }

    /**
     * Toggles the theme between light and dark, saves the preference.
     */
    function toggleTheme() {
        const currentTheme = htmlElement.dataset.theme || "light";
        const newTheme = currentTheme === "dark" ? "light" : "dark";
        applyTheme(newTheme);
        try {
            localStorage.setItem(themeLocalStorageKey, newTheme);
        } catch (e) {
            console.warn(
                "Could not save theme preference to localStorage:",
                e,
            );
        }
    }

    /**
     * Gets the initial theme based on localStorage or system preference.
     * @returns {'light' | 'dark'}
     */
    function getInitialTheme() {
        let savedTheme = null;
        try {
            savedTheme = localStorage.getItem(themeLocalStorageKey);
        } catch (e) {
            console.warn(
                "Could not read theme preference from localStorage:",
                e,
            );
        }

        if (
            savedTheme &&
            (savedTheme === "light" || savedTheme === "dark")
        ) {
            return savedTheme;
        }

        // Check system preference if no saved theme
        if (
            window.matchMedia &&
            window.matchMedia("(prefers-color-scheme: dark)")
                .matches
        ) {
            return "dark";
        }

        return "light"; // Default to light
    }

    // --- Initialization ---
    const initialTheme = getInitialTheme();
    applyTheme(initialTheme);

    // Add event listener AFTER the rest of the DOM is loaded potentially
    // Though for this button, it's fine here too.
    themeToggleBtn.addEventListener("click", toggleTheme);

    // Also listen for system preference changes if no user override exists
    window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", (event) => {
            // Only change if there's no user preference saved
            let savedTheme = null;
            try {
                savedTheme =
                    localStorage.getItem(themeLocalStorageKey);
            } catch (e) {} // Ignore error

            if (!savedTheme) {
                applyTheme(event.matches ? "dark" : "light");
            }
        });
})(); // End IIFE for theme script

// Wait for the DOM to be fully loaded for converter logic
document.addEventListener("DOMContentLoaded", () => {
    // --- DOM Element References ---
    const fileInput = document.getElementById("stexFile");
    const convertBtn = document.getElementById("convertBtn");
    const statusDiv = document.getElementById("status");
    const resultsDiv = document.getElementById("results");
    const progressContainer =
        document.getElementById("progress-container");
    const progressBar = document.getElementById("progress-bar");
    const uploadForm = document.getElementById("uploadForm"); // For potential form reset

    // --- State ---
    let currentDownloadUrl = null; // To manage Blob URL lifecycle

    // --- Constants ---
    const STEX_HEADER_SIZE = 32; // Bytes

    // --- Utility Functions ---

    /**
     * Updates the status message area.
     * @param {string} message - The message to display.
     * @param {'info'|'processing'|'success'|'error'} type - The type of message.
     */
    function updateStatus(message, type = "info") {
        // Clear previous content safely before setting new text
        while (statusDiv.firstChild) {
            statusDiv.removeChild(statusDiv.firstChild);
        }
        // Use text node for safety against XSS
        const textNode = document.createTextNode(message + " "); // Add space before file info
        statusDiv.appendChild(textNode);

        // Clear existing file info if present
        const existingFileInfo =
            statusDiv.querySelector(".file-info");
        if (existingFileInfo) {
            existingFileInfo.remove();
        }

        statusDiv.className = `status-${type}`; // Set class based on type
        statusDiv.style.display = "block";
        statusDiv.setAttribute(
            "aria-live",
            type === "error" ? "assertive" : "polite",
        ); // Accessibility
    }

    /**
     * Resets the UI to its initial state.
     */
    function resetUI() {
        statusDiv.style.display = "none";
        statusDiv.textContent = ""; // Clear content
        statusDiv.className = ""; // Clear status classes
        resultsDiv.innerHTML = ""; // Clear results (download link)
        progressContainer.style.display = "none";
        progressBar.style.width = "0%";
        progressBar.textContent = "0%";
        progressBar.setAttribute("aria-valuenow", "0");
        convertBtn.disabled = false; // Re-enable button
        // Optionally reset the form to clear the file input selection
        // uploadForm.reset(); // Uncomment if desired, but can be annoying

        // Revoke the previous Blob URL to prevent memory leaks
        if (currentDownloadUrl) {
            URL.revokeObjectURL(currentDownloadUrl);
            currentDownloadUrl = null;
        }
    }

    /**
     * Reads a File object as an ArrayBuffer using Promises.
     * @param {File} file - The file to read.
     * @param {(progressEvent: ProgressEvent<FileReader>) => void} onProgress - Progress callback.
     * @returns {Promise<ArrayBuffer>} A promise that resolves with the ArrayBuffer.
     */
    function readFileAsArrayBuffer(file, onProgress) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onloadstart = () => {
                if (onProgress)
                    onProgress({
                        lengthComputable: true,
                        loaded: 0,
                        total: file.size,
                    });
            };

            reader.onprogress = (event) => {
                if (onProgress) onProgress(event);
            };

            reader.onload = (event) => {
                if (event.target && event.target.result) {
                    resolve(event.target.result);
                } else {
                    reject(
                        new Error("File reading resulted in null."),
                    );
                }
            };

            reader.onerror = () => {
                console.error("File Reading Error:", reader.error);
                reject(
                    new Error(
                        `Could not read file: ${reader.error?.message || "Unknown error"}`,
                    ),
                );
            };

            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * Formats bytes into a human-readable string.
     * @param {number} bytes - The number of bytes.
     * @param {number} [decimals=2] - Number of decimal places.
     * @returns {string} Formatted size string.
     */
    function formatBytes(bytes, decimals = 2) {
        if (!+bytes) return "0 Bytes"; // Handle zero and non-numeric input
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = [
            "Bytes",
            "KB",
            "MB",
            "GB",
            "TB",
            "PB",
            "EB",
            "ZB",
            "YB",
        ];
        // Prevent log(0) or log(negative)
        if (bytes <= 0) return "0 Bytes";
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        // Ensure i is within bounds
        const safeIndex = Math.max(
            0,
            Math.min(i, sizes.length - 1),
        );
        return `${parseFloat((bytes / Math.pow(k, safeIndex)).toFixed(dm))} ${sizes[safeIndex]}`;
    }

    // --- Event Listeners ---

    /**
     * Handles the conversion process when the button is clicked.
     */
    async function handleConversion() {
        resetUI(); // Start fresh for each conversion attempt

        const file = fileInput.files?.[0]; // Optional chaining

        if (!file) {
            updateStatus(
                "❌ Error: Please select a file first.",
                "error",
            );
            return;
        }

        // Basic check for extension (provides user feedback)
        if (!file.name.toLowerCase().endsWith(".stex")) {
            updateStatus(
                `⚠️ Warning: Selected file "${file.name}" doesn't have a .stex extension. Processing anyway.`,
                "processing",
            );
        } else {
            updateStatus(
                `⚙️ Processing file: ${file.name}`,
                "processing",
            );
        }

        convertBtn.disabled = true; // Disable button during processing
        progressContainer.style.display = "block"; // Show progress bar container

        try {
            // Read the file with progress updates
            const arrayBuffer = await readFileAsArrayBuffer(
                file,
                (event) => {
                    if (event.lengthComputable && event.total > 0) {
                        const percentLoaded = Math.round(
                            (event.loaded / event.total) * 100,
                        );
                        progressBar.style.width = `${percentLoaded}%`;
                        progressBar.textContent = `${percentLoaded}%`;
                        progressBar.setAttribute(
                            "aria-valuenow",
                            percentLoaded.toString(),
                        );
                    } else {
                        // Handle indeterminate progress if needed
                        progressBar.textContent = `Loading...`;
                    }
                },
            );

            const originalSize = arrayBuffer.byteLength;

            // Validate file size against header size
            if (originalSize < STEX_HEADER_SIZE) {
                throw new Error(
                    `Input file "${file.name}" is too small (${formatBytes(originalSize)}). Expected at least ${STEX_HEADER_SIZE} bytes for the header.`,
                );
            }

            // --- Core Logic: Remove the Godot STEX header ---
            const pngData = arrayBuffer.slice(STEX_HEADER_SIZE);
            const outputSize = pngData.byteLength;

            if (outputSize === 0) {
                throw new Error(
                    `Conversion resulted in an empty file. The original file might not contain valid image data after the header.`,
                );
            }

            // Create Blob and generate a temporary URL for download
            const pngBlob = new Blob([pngData], {
                type: "image/png",
            });
            // Revoke previous URL *before* creating a new one if it exists
            if (currentDownloadUrl) {
                URL.revokeObjectURL(currentDownloadUrl);
            }
            currentDownloadUrl = URL.createObjectURL(pngBlob); // Store the new URL

            // Generate output filename (e.g., image.stex -> image.png)
            const baseName = file.name.replace(/\.stex$/i, ""); // Case-insensitive replace
            const outputFilename = `${baseName || "converted"}.png`; // Fallback name

            // Display success message first
            updateStatus(`✅ Conversion successful!`, "success");

            // Create and append download link to the results area
            const downloadLink = document.createElement("a");
            downloadLink.id = "download-link";
            downloadLink.href = currentDownloadUrl;
            downloadLink.download = outputFilename;
            downloadLink.textContent = `Download ${outputFilename}`;
            resultsDiv.appendChild(downloadLink);

            // Display file size info *within* the status div
            const sizeInfo = document.createElement("div");
            sizeInfo.classList.add("file-info");
            // Use innerHTML carefully here, ensuring formatBytes output is safe
            sizeInfo.innerHTML = `
            <span>ℹ️ Original:</span> ${formatBytes(originalSize)}<br>
            <span>ℹ️ Output:</span> ${formatBytes(outputSize)}
        `;
            statusDiv.appendChild(sizeInfo); // Append info inside status div

            // Ensure progress bar shows 100% on completion
            progressBar.style.width = "100%";
            progressBar.textContent = "100%";
            progressBar.setAttribute("aria-valuenow", "100");
        } catch (error) {
            console.error("Conversion Error:", error);
            const errorMessage =
                error instanceof Error
                    ? error.message
                    : String(error);
            // Display a user-friendly error message
            updateStatus(`❌ Error: ${errorMessage}`, "error");
            progressContainer.style.display = "none"; // Hide progress on error
            resultsDiv.innerHTML = ""; // Clear any potential stale download link
        } finally {
            // Re-enable the convert button regardless of success or failure
            convertBtn.disabled = false;
        }
    }

    // Attach the handler to the button click event
    convertBtn.addEventListener("click", handleConversion);

    // Reset UI if a new file is selected after a conversion attempt
    fileInput.addEventListener("change", () => {
        // Only reset if there's currently a status message or result showing
        if (
            statusDiv.style.display !== "none" ||
            resultsDiv.innerHTML !== ""
        ) {
            resetUI();
        }
        // Clear file input visually (if browser supports form reset well)
        // uploadForm.reset(); // Use reset() on the form for better clearing

        // Optional: Update file input display text immediately (more complex JS needed)
        // const fileName = fileInput.files[0]?.name;
        // Update some element to show `fileName` or "Choose file..."
    });
}); // End DOMContentLoaded