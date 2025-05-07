// === GLOBAL VARIABLES ===
let generatedCode = '';
let currentCleanedCode = '';
let originalUserPrompt = '';
let previewUpdateInterval = 500;
let lastPreviewUpdateTime = 0;
let isSidebarVisible = true;
let conversationHistory = [];

let apiKeyInput, userPromptInput, codeOutputElement, generateButton, loadingIndicator, errorMessageElement;
let previewFrame, refinementLoadingIndicator, intervalSlider, intervalValueDisplay;
let sidebar, mainContent, sidebarToggle, toggleIconOpen, toggleIconClose, modelSelector;

// === GENERATE OR REFINE FUNCTION ===
async function generateOrRefineCode(refinementData = null) {
    const apiKey = apiKeyInput.value.trim();
    const isRefinement = refinementData !== null;
    const currentPrompt = userPromptInput.value.trim();
    const selectedModel = modelSelector.value;

    if (!apiKey) {
        errorMessageElement.textContent = 'Error: API Key is required.';
        return;
    }
    if (!selectedModel) {
        errorMessageElement.textContent = 'Error: Please select a model.';
        return;
    }
    if (!isRefinement && !currentPrompt) {
        errorMessageElement.textContent = 'Error: Please enter a description.';
        return;
    }

    errorMessageElement.textContent = '';

    if (isRefinement) {
        refinementLoadingIndicator.style.display = 'flex';
        codeOutputElement.textContent = '';
    } else {
        generateButton.disabled = true;
        loadingIndicator.style.display = 'inline-block';
        originalUserPrompt = currentPrompt;
        lastPreviewUpdateTime = 0;
        conversationHistory = [];
        codeOutputElement.textContent = '';
    }

    const systemPrompt = `You are an expert web developer specializing in clean, modern HTML, CSS (using Tailwind CSS classes where possible), and JavaScript.
Generate the complete, runnable HTML code (including <!DOCTYPE html>, <html>, <head>, <style>, <body>, and <script> tags if necessary) for the user's request.
Ensure the code is self-contained and doesn't rely on external files unless specifically requested or essential (like Tailwind via CDN).
Include necessary CSS within <style> tags and JavaScript within <script> tags inside the HTML structure.
Use Tailwind CSS classes for styling elements. Assume Tailwind is available.
Use the Inter font.
Add comments to explain the code.
Output ONLY the raw, complete HTML code. Do NOT include any explanations, introductions, or markdown formatting.`;

    let userMessageContent = '';

    if (isRefinement) {
        userMessageContent = `Original User Request: "${originalUserPrompt}"
Current Full HTML Code: \`\`\`html\n${currentCleanedCode}\n\`\`\`
Selected HTML Element to Refine: \`\`\`html\n${refinementData.elementHTML}\n\`\`\`
User's Refinement Instructions: "${refinementData.instructions}"

Instructions: Modify ONLY the necessary parts of the Current Full HTML Code to implement the refinement. Ensure the refined code remains a single, complete, runnable HTML document. Maintain Tailwind CSS. Output ONLY the raw, complete, refined HTML code.`;
        conversationHistory.push({ role: "user", content: userMessageContent });
    } else {
        userMessageContent = `User Request: "${originalUserPrompt}"`;
        conversationHistory = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessageContent }
        ];
    }

    const API_BASE_URL = "https://api.novita.ai/v3/openai";
    const API_ENDPOINT = `${API_BASE_URL}/chat/completions`;

    let rawGeneratedCode = '';

    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: selectedModel,
                messages: conversationHistory,
                stream: true
            })
        });

        if (!response.ok) {
            let errorMsg = `API Error: ${response.status}`;
            if (response.status === 401) errorMsg += ' - Unauthorized';
            else if (response.status === 429) errorMsg += ' - Rate Limit Exceeded';
            throw new Error(errorMsg);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let streamEnded = false;

        while (!streamEnded) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.substring(6).trim();
                    if (data === '[DONE]') {
                        streamEnded = true;
                        break;
                    }
                    const json = JSON.parse(data);
                    const content = json.choices?.[0]?.delta?.content;
                    if (content) {
                        rawGeneratedCode += content;
                        const displayCode = rawGeneratedCode.replace(/^```html\s*/i, '').replace(/```$/, '').trim();
                        codeOutputElement.textContent = displayCode;
                        codeOutputElement.parentElement.scrollTop = codeOutputElement.parentElement.scrollHeight;
                        if (Date.now() - lastPreviewUpdateTime > previewUpdateInterval) {
                            updateLivePreview(displayCode);
                            lastPreviewUpdateTime = Date.now();
                        }
                    }
                }
            }
        }

        if (rawGeneratedCode) {
            conversationHistory.push({ role: "assistant", content: rawGeneratedCode });
        }

        let cleanedCode = rawGeneratedCode.replace(/^```html\s*/i, '').replace(/```$/, '').trim();

        if (!cleanedCode.toLowerCase().includes('<!doctype html>')) {
            cleanedCode = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Generated Content</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
  <style>html { font-family: 'Inter', sans-serif; }</style>
</head>
<body class="p-4">
${cleanedCode}
</body>
</html>`;
        }

        currentCleanedCode = cleanedCode;

        const interactionScript = `
<script>
${getInteractionScript()}
<\/script>`;

        const insertAt = currentCleanedCode.lastIndexOf('</body>');
        generatedCode = insertAt !== -1
            ? currentCleanedCode.slice(0, insertAt) + interactionScript + currentCleanedCode.slice(insertAt)
            : currentCleanedCode + interactionScript;

        codeOutputElement.textContent = currentCleanedCode;
        updateLivePreview();

    } catch (error) {
        errorMessageElement.textContent = error.message || "Unexpected error occurred.";
        updateLivePreview(`<div class="p-4 text-red-600">Error generating preview.</div>`);
    } finally {
        if (isRefinement) {
            refinementLoadingIndicator.style.display = 'none';
        } else {
            generateButton.disabled = false;
            loadingIndicator.style.display = 'none';
        }
    }
}

// === PREVIEW RENDERING ===
function updateLivePreview(code = null) {
    const html = code || generatedCode || '';
    previewFrame.srcdoc = html || '<div class="p-4 text-gray-500">Generate code to see preview</div>';
}

// === SIDEBAR TOGGLE ===
function toggleSidebar() {
    isSidebarVisible = !isSidebarVisible;
    const sidebarClasses = ['w-full', 'md:w-1/2', 'lg:w-1/3', 'xl:w-1/4'];
    const contentClasses = ['md:w-1/2', 'lg:w-2/3', 'xl:w-3/4'];

    if (isSidebarVisible) {
        sidebar.classList.remove('hidden');
        sidebar.classList.add(...sidebarClasses);
        mainContent.classList.remove('w-full');
        mainContent.classList.add('w-full', ...contentClasses);
        toggleIconOpen.classList.add('hidden');
        toggleIconClose.classList.remove('hidden');
    } else {
        sidebar.classList.add('hidden');
        sidebar.classList.remove(...sidebarClasses);
        mainContent.classList.remove('w-full', ...contentClasses);
        mainContent.classList.add('w-full');
        toggleIconOpen.classList.remove('hidden');
        toggleIconClose.classList.add('hidden');
    }
}

// === HANDLE IFRAME MESSAGE ===
function receiveMessageFromIframe(event) {
    const { type, payload } = event.data;
    if (type === 'refineRequest' && payload?.instructions && payload?.elementHTML) {
        generateOrRefineCode(payload);
    }
}

// === INITIALIZE DOM ===
document.addEventListener('DOMContentLoaded', () => {
    apiKeyInput = document.getElementById('api-key');
    userPromptInput = document.getElementById('user-prompt');
    codeOutputElement = document.getElementById('code-output').querySelector('code');
    generateButton = document.getElementById('generate-button');
    loadingIndicator = document.getElementById('loading-indicator');
    errorMessageElement = document.getElementById('error-message');
    previewFrame = document.getElementById('preview-frame');
    refinementLoadingIndicator = document.getElementById('refinement-loading-indicator');
    intervalSlider = document.getElementById('preview-interval-slider');
    intervalValueDisplay = document.getElementById('interval-value');
    sidebar = document.getElementById('sidebar');
    mainContent = document.getElementById('main-content');
    sidebarToggle = document.getElementById('sidebar-toggle');
    toggleIconOpen = document.getElementById('toggle-icon-open');
    toggleIconClose = document.getElementById('toggle-icon-close');
    modelSelector = document.getElementById('model-selector');

    generateButton.addEventListener('click', () => generateOrRefineCode());
    sidebarToggle.addEventListener('click', toggleSidebar);
    window.addEventListener('message', receiveMessageFromIframe);
    intervalSlider.addEventListener('input', (e) => {
        previewUpdateInterval = parseInt(e.target.value, 10);
        intervalValueDisplay.textContent = previewUpdateInterval;
    });

    previewUpdateInterval = parseInt(intervalSlider.value, 10);
    intervalValueDisplay.textContent = previewUpdateInterval;
    updateLivePreview();
});

function getInteractionScript() {
  return `
(function() {
  if (window.frameElement && window.parent) {
    console.log('[Interaction Script] Initializing inside iframe.');
    let lastHoveredElement = null;
    let originalOutline = '';
    let rightClickedElement = null;
    const highlightStyle = '2px dashed #007bff';
    const contextMenuId = 'refine-context-menu';

    function removeContextMenu() {
      const existingMenu = document.getElementById(contextMenuId);
      if (existingMenu) {
        console.log('[Interaction Script] Removing context menu.');
        existingMenu.remove();
      }
      rightClickedElement = null;
    }

    document.body.addEventListener('mouseover', function(event) {
      if (!event.target || event.target === document.body || event.target === document.documentElement || event.target.id === contextMenuId || event.target.closest('#' + contextMenuId)) {
        return;
      }
      if (event.target !== lastHoveredElement) {
        if (lastHoveredElement) {
          try { lastHoveredElement.style.outline = originalOutline; } catch(e) {}
        }
        lastHoveredElement = event.target;
        try { originalOutline = lastHoveredElement.style.outline || ''; } catch(e) { originalOutline = ''; }
        try { lastHoveredElement.style.outline = highlightStyle; } catch(e) {}
      }
    }, false);

    document.body.addEventListener('mouseout', function(event) {
      if (event.target === lastHoveredElement) {
        try { lastHoveredElement.style.outline = originalOutline; } catch(e) {}
        lastHoveredElement = null;
        originalOutline = '';
      }
    }, false);

    document.body.addEventListener('contextmenu', function(event) {
      if (!event.target || event.target === document.body || event.target === document.documentElement || event.target.id === contextMenuId || event.target.closest('#' + contextMenuId)) {
        return;
      }
      console.log('[Interaction Script] Context menu triggered on:', event.target.tagName);
      event.preventDefault();
      removeContextMenu();
      rightClickedElement = event.target;

      const menu = document.createElement('div');
      menu.id = contextMenuId;
      menu.style.position = 'absolute';
      menu.style.left = \`\${event.pageX + 2}px\`;
      menu.style.top = \`\${event.pageY + 2}px\`;
      menu.style.backgroundColor = 'white';
      menu.style.border = '1px solid #ccc';
      menu.style.boxShadow = '2px 2px 5px rgba(0,0,0,0.2)';
      menu.style.padding = '10px';
      menu.style.zIndex = '10000';
      menu.style.borderRadius = '4px';
      menu.style.fontSize = '14px';
      menu.style.fontFamily = 'sans-serif';
      menu.style.color = '#333';
      menu.style.minWidth = '220px';

      const textarea = document.createElement('textarea');
      textarea.rows = 3;
      textarea.placeholder = 'Describe refinement... (e.g., make text blue, add padding)';
      textarea.style.width = '100%';
      textarea.style.boxSizing = 'border-box';
      textarea.style.display = 'block';
      textarea.style.marginBottom = '8px';
      textarea.style.border = '1px solid #ccc';
      textarea.style.padding = '5px';
      textarea.style.borderRadius = '3px';
      textarea.style.fontSize = '13px';

      const button = document.createElement('button');
      button.textContent = 'Refine';
      button.style.padding = '5px 10px';
      button.style.border = 'none';
      button.style.backgroundColor = '#007bff';
      button.style.color = 'white';
      button.style.borderRadius = '3px';
      button.style.cursor = 'pointer';
      button.style.fontSize = '13px';
      button.style.width = '100%';

      button.onclick = function() {
        if (rightClickedElement) {
          const instructions = textarea.value.trim();
          if (!instructions) {
            alert('Please enter refinement instructions.');
            textarea.focus();
            return;
          }
          let elementHTML = '';
          try { elementHTML = rightClickedElement.outerHTML; } catch(e) {}

          console.log('[Interaction Script] Sending refine request:', { instructions, elementHTML });
          window.parent.postMessage({
            type: 'refineRequest',
            payload: {
              instructions: instructions,
              elementHTML: elementHTML
            }
          }, '*');
          removeContextMenu();
        } else {
          console.warn('[Interaction Script] Refine clicked but rightClickedElement is null.');
        }
      };

      menu.appendChild(textarea);
      menu.appendChild(button);
      document.body.appendChild(menu);
      textarea.focus();
    });

    document.addEventListener('click', function(event) {
      const menu = document.getElementById(contextMenuId);
      if (menu && !menu.contains(event.target)) {
        console.log('[Interaction Script] Closing context menu due to outside click.');
        removeContextMenu();
      }
    }, true);

    window.addEventListener('blur', function() {
      console.log('[Interaction Script] Iframe lost focus, removing context menu.');
      removeContextMenu();
      if (lastHoveredElement) {
        try { lastHoveredElement.style.outline = originalOutline; } catch(e) {}
        lastHoveredElement = null;
        originalOutline = '';
      }
    });

    console.log('[Interaction Script] Event listeners added.');
  } else {
    console.log('[Interaction Script] Not running inside an iframe or parent access denied.');
  }
})();
`.trim();
}

