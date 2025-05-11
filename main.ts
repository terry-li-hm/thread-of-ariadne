import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, ItemView, ViewStateResult } from 'obsidian';

// Thread of Ariadne plugin: Find notes with similar embedding vectors
// Now with Gemini API integration!

interface ThreadOfAriadneSettings {
	apiKey: string;
	numSimilarNotes: number;
	minSimilarityScore: number;
	ignoreFolders: string[];
	cacheExpiration: number;
	useGeminiEmbeddings: boolean;
	encryptedApiKey?: string; // Optional field for encrypted API key
}

const DEFAULT_SETTINGS: ThreadOfAriadneSettings = {
	apiKey: '',
	numSimilarNotes: 5,
	minSimilarityScore: 0.7,
	ignoreFolders: [],
	cacheExpiration: 7, // days
	useGeminiEmbeddings: false
}

interface EmbeddingCacheItem {
	embedding: number[];
	timestamp: number;
}

interface SimilarNoteResult {
	file: TFile;
	score: number;
}

const SIMILAR_NOTES_VIEW_TYPE = 'thread-of-ariadne-view';

export default class ThreadOfAriadne extends Plugin {
	settings: ThreadOfAriadneSettings;
	embeddings: Map<string, EmbeddingCacheItem> = new Map();
	sidebar: SimilarNotesSidebar | null = null;
	
	async onload() {
		await this.loadSettings();
		await this.loadEmbeddingCache();
		
		// Add the ribbon icon for finding similar notes
		this.addRibbonIcon('search', 'Find Similar Notes', (evt: MouseEvent) => {
			this.findSimilarNotes();
		});
		
		// Add a command to find similar notes
		this.addCommand({
			id: 'find-similar-notes',
			name: 'Find similar notes to current note',
			checkCallback: (checking: boolean) => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView) {
					if (!checking) {
						this.findSimilarNotes();
					}
					return true;
				}
				return false;
			}
		});
		
		// Register a view type for our sidebar
		this.registerView(
			SIMILAR_NOTES_VIEW_TYPE,
			(leaf): SimilarNotesSidebar => {
				const view = new SimilarNotesSidebar(leaf, this);
				this.sidebar = view;
				return view;
			}
		);
		
		// Register workspace event to automatically update when changing notes
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', async () => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView && this.sidebar && this.sidebar.isVisible) {
					await this.findSimilarNotes();
				}
			})
		);
		
		// Add a settings tab
		this.addSettingTab(new ThreadOfAriadneSettingTab(this.app, this));
	}
	
	onunload() {
		this.saveEmbeddingCache();
	}
	
	async loadSettings() {
		// Load settings using Obsidian's data API
		const loadedData = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);

		// If we have an encrypted API key, decrypt it
		if (loadedData?.encryptedApiKey) {
			try {
				this.settings.apiKey = await this.decryptApiKey(loadedData.encryptedApiKey);
			} catch (error) {
				console.error('Failed to decrypt API key:', error);
				this.settings.apiKey = '';
			}
		}
	}

	async saveSettings() {
		// Create a copy of settings to save
		const dataToSave: ThreadOfAriadneSettings = { ...this.settings };

		// Don't save the API key in plain text
		if (this.settings.apiKey) {
			// Encrypt the API key before saving
			try {
				dataToSave.encryptedApiKey = await this.encryptApiKey(this.settings.apiKey);
			} catch (error) {
				console.error('Failed to encrypt API key:', error);
				// If encryption fails, store a placeholder instead
				dataToSave.encryptedApiKey = '*****';
			}
		}

		// Create a new object without the apiKey property
		const dataToStore: Record<string, any> = {};

		// Copy all properties except apiKey
		Object.entries(dataToSave).forEach(([key, value]) => {
			if (key !== 'apiKey') {
				dataToStore[key] = value;
			}
		});

		// Save the settings
		await this.saveData(dataToStore);
	}

	// Simple encryption for the API key (using SubtleCrypto)
	async encryptApiKey(apiKey: string): Promise<string> {
		// For true security, consider using the SystemKeyStore in a production environment
		// This is a simplified version for demonstration purposes

		// Generate a random initialization vector
		const iv = crypto.getRandomValues(new Uint8Array(12));

		// Use a derivation of the device ID as the password
		const password = await this.getEncryptionKey();

		// Convert the API key to bytes
		const encoder = new TextEncoder();
		const apiKeyBytes = encoder.encode(apiKey);

		// Import the key
		const key = await crypto.subtle.importKey(
			'raw',
			await crypto.subtle.digest('SHA-256', encoder.encode(password)),
			{ name: 'AES-GCM' },
			false,
			['encrypt']
		);

		// Encrypt the API key
		const encryptedBytes = await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv },
			key,
			apiKeyBytes
		);

		// Combine the IV and encrypted data and convert to base64
		const combinedArray = new Uint8Array(iv.length + encryptedBytes.byteLength);
		combinedArray.set(iv, 0);
		combinedArray.set(new Uint8Array(encryptedBytes), iv.length);

		// Convert to base64
		return btoa(String.fromCharCode(...combinedArray));
	}

	// Decrypt the API key
	async decryptApiKey(encryptedApiKey: string): Promise<string> {
		try {
			// Convert from base64
			const combinedArray = new Uint8Array(
				atob(encryptedApiKey).split('').map(char => char.charCodeAt(0))
			);

			// Extract the IV and encrypted data
			const iv = combinedArray.slice(0, 12);
			const encryptedBytes = combinedArray.slice(12);

			// Use a derivation of the device ID as the password
			const password = await this.getEncryptionKey();

			// Import the key
			const encoder = new TextEncoder();
			const key = await crypto.subtle.importKey(
				'raw',
				await crypto.subtle.digest('SHA-256', encoder.encode(password)),
				{ name: 'AES-GCM' },
				false,
				['decrypt']
			);

			// Decrypt the API key
			const decryptedBytes = await crypto.subtle.decrypt(
				{ name: 'AES-GCM', iv },
				key,
				encryptedBytes
			);

			// Convert back to a string
			const decoder = new TextDecoder();
			return decoder.decode(decryptedBytes);
		} catch (error) {
			console.error('Decryption failed:', error);
			return '';
		}
	}

	// Get a unique encryption key based on this device and vault
	async getEncryptionKey(): Promise<string> {
		// Create a unique identifier based on the plugin ID and vault path
		// This is simple but effective - for production, consider more secure approaches
		const uniqueId = `thread-of-ariadne-${this.app.vault.getName()}-${location.hostname}`;
		return uniqueId;
	}
	
	async loadEmbeddingCache() {
		const data = await this.loadData();
		if (data?.embeddings) {
			this.embeddings = new Map(Object.entries(data.embeddings));
			// Clean expired cache entries
			this.cleanEmbeddingCache();
		}
	}
	
	async saveEmbeddingCache() {
		const embeddingsObj = Object.fromEntries(this.embeddings);
		await this.saveData({
			...await this.loadData(),
			embeddings: embeddingsObj
		});
	}
	
	cleanEmbeddingCache() {
		const now = Date.now();
		const expiration = this.settings.cacheExpiration * 24 * 60 * 60 * 1000; // days to ms
		
		for (const [path, cacheItem] of this.embeddings.entries()) {
			if (now - cacheItem.timestamp > expiration) {
				this.embeddings.delete(path);
			}
		}
	}
	
	// Get embeddings using either Gemini API or local method
	async getEmbedding(text: string): Promise<number[]> {
		// Use Gemini API if enabled and API key is provided
		if (this.settings.useGeminiEmbeddings && this.settings.apiKey) {
			try {
				return await this.getGeminiEmbedding(text);
			} catch (error) {
				console.error('Failed to get Gemini embedding:', error);
				new Notice('Thread of Ariadne: Failed to get Gemini embedding. Falling back to local method.');
				// Fall back to local method if API call fails
				return this.getLocalEmbedding(text);
			}
		} else {
			// Use local method
			return this.getLocalEmbedding(text);
		}
	}

	// Get embeddings using the Gemini API
	async getGeminiEmbedding(text: string): Promise<number[]> {
		const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-exp-03-07:embedContent";
		
		// Validate API key
		if (!this.settings.apiKey || this.settings.apiKey.trim() === '') {
			new Notice('Thread of Ariadne: Missing Gemini API Key. Please add it in settings.');
			throw new Error('Missing API key');
		}

		// Prepare the request body
		const requestBody = {
			content: {
				parts: [
					{ text: text }
				]
			}
		};

		try {
			// Show a status indicator for API calls
			const statusBarItem = this.addStatusBarItem();
			statusBarItem.setText('⏳ Generating embedding...');
			
			// Make the API request
			const response = await fetch(`${url}?key=${this.settings.apiKey}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(requestBody)
			});
			
			// Clean up status bar
			statusBarItem.remove();
			
			// Handle error responses
			if (!response.ok) {
				const errorData = await response.json().catch(() => null);
				let errorMessage = `API Error (${response.status})`;
				
				// Extract useful error information if available
				if (errorData && errorData.error) {
					errorMessage = `${errorData.error.message || errorMessage} (${errorData.error.status || 'unknown'})`;
					console.error('Gemini API error details:', errorData.error);
				}
				
				new Notice(`Thread of Ariadne: ${errorMessage}`);
				throw new Error(errorMessage);
			}
			
			const data = await response.json();
			
			// Validate the response contains what we expect
			if (!data.embedding || !data.embedding.values || !Array.isArray(data.embedding.values)) {
				console.error('Unexpected API response format:', data);
				throw new Error('Invalid API response format');
			}
			
			// The Gemini API returns a 3072-dimensional vector; we'll use it as is
			return data.embedding.values;
		} catch (error) {
			console.error("Error fetching Gemini embeddings:", error);
			// Rethrow for the calling code to handle
			throw error;
		}
	}

	// Simplified local embedding implementation
	getLocalEmbedding(text: string): number[] {
		// Create a simplified vector based on word frequency (just for demo purposes)
		const words = text.toLowerCase().match(/\w+/g) || [];
		const wordFreq: Record<string, number> = {};
		
		// Count word frequencies
		for (const word of words) {
			wordFreq[word] = (wordFreq[word] || 0) + 1;
		}
		
		// Create a simple 100-dimensional vector (just use word hashes)
		const vector = new Array(100).fill(0);
		for (const word of Object.keys(wordFreq)) {
			const hash = this.simpleHash(word) % 100;
			vector[hash] += wordFreq[word];
		}
		
		// Normalize the vector
		const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
		if (magnitude > 0) {
			for (let i = 0; i < vector.length; i++) {
				vector[i] /= magnitude;
			}
		}
		
		return vector;
	}
	
	// A simple string hash function for demo purposes
	simpleHash(str: string): number {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash; // Convert to 32bit integer
		}
		return Math.abs(hash);
	}
	
	async getNoteEmbedding(file: TFile): Promise<number[]> {
		// Check if we have a cached embedding
		if (this.embeddings.has(file.path)) {
			const cacheEntry = this.embeddings.get(file.path);
			// Check if file was modified after embedding was cached
			if (cacheEntry && file.stat.mtime <= cacheEntry.timestamp) {
				return cacheEntry.embedding;
			}
		}
		
		// Generate a new embedding
		const content = await this.app.vault.read(file);
		const embedding = await this.getEmbedding(content);
		
		// Cache the embedding
		this.embeddings.set(file.path, {
			embedding,
			timestamp: Date.now()
		});
		
		return embedding;
	}
	
	cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length) return 0;
		
		let dotProduct = 0;
		let normA = 0;
		let normB = 0;
		
		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}
		
		if (normA === 0 || normB === 0) return 0;
		
		return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
	}
	
	shouldIgnoreFile(file: TFile): boolean {
		if (!file.extension || file.extension !== 'md') return true;
		
		for (const folder of this.settings.ignoreFolders) {
			if (file.path.startsWith(folder)) return true;
		}
		
		return false;
	}
	
	async findSimilarNotes() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			new Notice('Thread of Ariadne: No active note');
			return;
		}
		
		const currentFile = activeView.file;
		if (!currentFile) {
			new Notice('Thread of Ariadne: No active note file');
			return;
		}
		
		// Show a loading notice
		const loadingNotice = new Notice('Thread of Ariadne: Finding similar notes...', 0);
		
		try {
			// Get the embedding for the current note
			const currentEmbedding = await this.getNoteEmbedding(currentFile);
			
			// Get all markdown files
			const files = this.app.vault.getMarkdownFiles();
			
			// Calculate similarity scores
			const similarityScores: SimilarNoteResult[] = [];
			
			for (const file of files) {
				// Skip the current file and ignored files
				if (file.path === currentFile.path || this.shouldIgnoreFile(file)) {
					continue;
				}
				
				const embedding = await this.getNoteEmbedding(file);
				const similarity = this.cosineSimilarity(currentEmbedding, embedding);
				
				if (similarity >= this.settings.minSimilarityScore) {
					similarityScores.push({ file, score: similarity });
				}
			}
			
			// Sort by similarity score (descending)
			similarityScores.sort((a, b) => b.score - a.score);
			
			// Limit to the specified number of results
			const topResults = similarityScores.slice(0, this.settings.numSimilarNotes);
			
			// Update or create the sidebar with results
			if (this.sidebar) {
				if (!this.sidebar.isVisible) {
					await this.activateSidebar();
				}
				
				this.sidebar.updateResults(currentFile, topResults);
			} else {
				await this.activateSidebar();
				
				// A small delay to ensure the sidebar is created
				setTimeout(() => {
					if (this.sidebar) {
						this.sidebar.updateResults(currentFile, topResults);
					}
				}, 300);
			}
			
			// Save the embedding cache periodically
			this.saveEmbeddingCache();
			
		} catch (error) {
			console.error('Thread of Ariadne: Error finding similar notes', error);
			new Notice('Thread of Ariadne: Error finding similar notes');
		} finally {
			// Clear the loading notice
			loadingNotice.hide();
		}
	}
	
	async activateSidebar() {
		const { workspace } = this.app;
		
		// Check if the view is already open
		const existingLeaf = workspace.getLeavesOfType(SIMILAR_NOTES_VIEW_TYPE)[0];
		if (existingLeaf) {
			workspace.revealLeaf(existingLeaf);
			return;
		}
		
		const leaf = workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({
				type: SIMILAR_NOTES_VIEW_TYPE,
				active: true,
			});
			workspace.revealLeaf(leaf);
		}
	}
}

class SimilarNotesSidebar extends ItemView {
	plugin: ThreadOfAriadne;
	isVisible: boolean = false;
	
	constructor(leaf: WorkspaceLeaf, plugin: ThreadOfAriadne) {
		super(leaf);
		this.plugin = plugin;
		this.isVisible = true;
	}
	
	getViewType(): string {
		return SIMILAR_NOTES_VIEW_TYPE;
	}
	
	getDisplayText(): string {
		return 'Similar Notes';
	}
	
	getIcon(): string {
		return 'git-fork';
	}
	
	updateResults(currentFile: TFile, results: SimilarNoteResult[]) {
		const contentEl = this.containerEl.querySelector('.view-content');
		if (!contentEl) return;
		
		contentEl.empty();
		
		const container = contentEl.createDiv({ cls: 'thread-of-ariadne-container' });
		
		// Create header
		const header = container.createEl('h3', {
			text: `Notes Similar to: ${currentFile.basename}`,
		});
		
		// Add indicator for embedding type being used
		const embeddingType = container.createEl('div', {
			cls: 'thread-of-ariadne-embedding-type',
			text: this.plugin.settings.useGeminiEmbeddings 
				? '🧠 Using Gemini embeddings'
				: '🧮 Using local embeddings'
		});
		
		if (results.length === 0) {
			container.createEl('p', {
				text: 'No similar notes found matching your criteria.',
			});
			return;
		}
		
		// Create results list
		const list = container.createEl('ul', { cls: 'thread-of-ariadne-list' });
		
		for (const result of results) {
			const item = list.createEl('li', { cls: 'thread-of-ariadne-item' });
			
			const link = item.createEl('a', {
				cls: 'thread-of-ariadne-link',
				text: result.file.basename,
			});
			
			link.addEventListener('click', (e) => {
				e.preventDefault();
				this.app.workspace.openLinkText(result.file.path, '', false);
			});
			
			// Create score element with styling based on similarity
			const scoreValue = result.score;
			let scoreCategory = 'low';
			if (scoreValue >= 0.85) {
				scoreCategory = 'high';
			} else if (scoreValue >= 0.75) {
				scoreCategory = 'medium';
			}
			
			const score = item.createEl('span', {
				cls: 'thread-of-ariadne-score',
				text: `${(scoreValue * 100).toFixed(0)}%`,
				attr: { 'data-score': scoreCategory }
			});
		}
	}
	
	async onOpen() {
		this.isVisible = true;
		const contentEl = this.containerEl.querySelector('.view-content');
		if (contentEl) {
			contentEl.empty();
			contentEl.createEl('p', {
				text: 'Select a note to see similar notes.',
			});
		}
	}
	
	async onClose() {
		this.isVisible = false;
		return super.onClose();
	}
}

class ThreadOfAriadneSettingTab extends PluginSettingTab {
	plugin: ThreadOfAriadne;
	
	constructor(app: App, plugin: ThreadOfAriadne) {
		super(app, plugin);
		this.plugin = plugin;
	}
	
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Thread of Ariadne Settings' });

		// Embedding Model Settings Section
		containerEl.createEl('h3', { text: 'Embedding Model' });

		new Setting(containerEl)
			.setName('Use Gemini Embeddings')
			.setDesc('Use Google Gemini API for high-quality embeddings (requires API key).')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useGeminiEmbeddings)
				.onChange(async (value) => {
					this.plugin.settings.useGeminiEmbeddings = value;
					await this.plugin.saveSettings();
				}));

		const apiKeySetting = new Setting(containerEl)
			.setName('Gemini API Key')
			.setDesc('Your Google API key for accessing the Gemini embeddings API.')
			.addText(text => {
				text.setPlaceholder('Enter your API key')
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					});
				// Use password field to hide the API key
				text.inputEl.type = 'password';
				text.inputEl.setAttribute('autocomplete', 'off');
				text.inputEl.setAttribute('autocorrect', 'off');
				text.inputEl.setAttribute('autocapitalize', 'off');
				text.inputEl.setAttribute('spellcheck', 'false');
			});

		// Link to get an API key
		const apiKeyDescription = containerEl.createEl('div', {
			cls: 'setting-item-description',
			text: 'You can get a Gemini API key from: '
		});
		apiKeyDescription.createEl('a', {
			text: 'Google AI Studio',
			href: 'https://makersuite.google.com/app/apikey'
		}).setAttribute('target', '_blank');

		containerEl.createEl('h3', { text: 'Similarity Settings' });

		new Setting(containerEl)
			.setName('Number of Similar Notes')
			.setDesc('Maximum number of similar notes to display.')
			.addSlider(slider => slider
				.setLimits(1, 20, 1)
				.setValue(this.plugin.settings.numSimilarNotes)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.numSimilarNotes = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Minimum Similarity Score')
			.setDesc('Minimum similarity score (0-1) for notes to be considered similar.')
			.addSlider(slider => slider
				.setLimits(0, 1, 0.05)
				.setValue(this.plugin.settings.minSimilarityScore)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.minSimilarityScore = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h3', { text: 'Cache Settings' });

		new Setting(containerEl)
			.setName('Ignored Folders')
			.setDesc('Comma-separated list of folders to ignore when finding similar notes.')
			.addTextArea(text => text
				.setValue(this.plugin.settings.ignoreFolders.join(', '))
				.onChange(async (value) => {
					this.plugin.settings.ignoreFolders = value
						.split(',')
						.map(folder => folder.trim())
						.filter(folder => folder.length > 0);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Cache Expiration (Days)')
			.setDesc('Number of days after which cached embeddings expire.')
			.addSlider(slider => slider
				.setLimits(1, 30, 1)
				.setValue(this.plugin.settings.cacheExpiration)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.cacheExpiration = value;
					await this.plugin.saveSettings();
				}));

		const clearCacheButton = new Setting(containerEl)
			.setName('Clear Embedding Cache')
			.setDesc('Clear all cached embeddings. This will force recalculation of embeddings.')
			.addButton(button => button
				.setButtonText('Clear Cache')
				.onClick(async () => {
					this.plugin.embeddings.clear();
					await this.plugin.saveEmbeddingCache();
					new Notice('Thread of Ariadne: Embedding cache cleared');
				}));

		// Display mode information
		containerEl.createEl('div', {
			cls: 'setting-item-description',
			text: this.plugin.settings.useGeminiEmbeddings 
				? 'Using Gemini embeddings for high-quality semantic similarity.'
				: 'Using local embedding method (less accurate but works offline).'
		});
	}
}