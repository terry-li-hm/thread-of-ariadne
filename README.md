# Thread of Ariadne

An Obsidian plugin that uses vector embeddings to find semantically similar notes to the one you're currently viewing. Like Ariadne's thread in the labyrinth, this plugin helps you navigate the complex connections between your notes based on meaning, not just explicit links.

## Features

- **Semantic similarity search**: Finds notes with similar meaning, not just keyword matches
- **Google Gemini AI integration**: Uses the powerful Gemini embedding model for high-quality similarity detection
- **Customizable sidebar**: Shows similar notes in a dedicated sidebar view
- **Real-time updates**: Automatically updates when switching notes
- **Adjustable similarity threshold**: Control how closely notes must match to appear in results
- **Embedding caching**: Stores note embeddings to improve performance during repeated searches
- **Folder exclusion**: Exclude specific folders from similarity searches
- **Secure API key storage**: Encrypted storage for your Gemini API key

## How It Works

Thread of Ariadne uses AI embedding models to transform your notes into vector representations that capture their semantic meaning. When you view a note, the plugin:

1. Generates an embedding vector for your current note (using either Google Gemini or a local algorithm)
2. Compares this vector with the embeddings of other notes in your vault
3. Calculates similarity scores using cosine similarity
4. Displays the most similar notes in a sidebar

The plugin offers two embedding modes:

- **Local Embedding**: Built-in algorithm that works offline, creating embeddings based on word frequency and hashing
- **Gemini Embedding**: Uses Google's state-of-the-art Gemini embedding model (`gemini-embedding-exp-03-07`) for high-quality similarity detection

## Usage

1. Open any note in your vault
2. Click the "Thread of Ariadne" icon in the left ribbon or use the command "Find similar notes to current note"
3. A sidebar will open showing notes with similar meaning to your current note
4. Click on any result to navigate directly to that note

### Using Gemini Embeddings

To enable the Gemini AI-powered embeddings for better quality results:

1. Go to plugin settings
2. Toggle on "Use Gemini Embeddings"
3. Enter your Google Gemini API key (you can get one from [Google AI Studio](https://makersuite.google.com/app/apikey))
4. The plugin will now use Gemini embeddings for more accurate similarity detection

Note: Without enabling Gemini embeddings, the plugin will use a local embedding algorithm that works offline but provides less accurate results.

## Settings

### Embedding Model Settings
- **Use Gemini Embeddings**: Toggle to enable Google's Gemini API for high-quality embeddings
- **Gemini API Key**: Your API key for accessing the Gemini embeddings API (securely stored)

### Similarity Settings
- **Number of Similar Notes**: Maximum number of similar notes to display (1-20)
- **Minimum Similarity Score**: Threshold for notes to be considered similar (0-1)

### Cache Settings
- **Ignored Folders**: Folders to exclude from similarity searches
- **Cache Expiration**: Number of days before cached embeddings expire (1-30)
- **Clear Embedding Cache**: Button to clear all cached embeddings and force recalculation

## Installation

### From Obsidian Community Plugins

*Coming soon*

### Manual Installation

1. Download `main.js`, `styles.css`, and `manifest.json` from the latest release
2. Create a folder called `thread-of-ariadne` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into this folder
4. Enable the plugin in Obsidian's Community Plugins settings

## Development

If you want to contribute to the plugin:

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run dev` to start compilation in watch mode
4. Make changes to the code
5. Use `npm run build` to create a production build

## Requirements

- Obsidian v0.15.0 or higher
- Internet connection (first time only, for downloading the embedding model)

## Credits

- Integrates with [Google Gemini API](https://ai.google.dev/gemini-api) for high-quality embeddings
- Uses the experimental `gemini-embedding-exp-03-07` model for state-of-the-art text embeddings
- Name inspired by the Greek myth of Theseus and the Minotaur, where Ariadne's thread helped Theseus navigate the labyrinth

## Privacy & Security

- Your Gemini API key is encrypted before being stored in the plugin's settings
- Content is processed locally first, and only sent to Google's servers if Gemini embeddings are enabled
- No data is shared with any third parties other than Google (when using Gemini embeddings)
- You can always use the offline mode (local embeddings) if you prefer not to use external services

## License

MIT