import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import type { WebSocket } from 'partysocket';

const AUTO_SAVE_DELAY = 3000; // 3 seconds

interface UseFileEditorOptions {
	/** The active file path */
	filePath: string;
	/** The current file content */
	initialContent: string;
	/** WebSocket connection for sending updates */
	websocket?: WebSocket;
	/** Whether editing is enabled */
	readOnly?: boolean;
	/** Callback when file is successfully saved */
	onSaved?: (filePath: string) => void;
	/** Callback when save fails */
	onError?: (error: string) => void;
}

interface UseFileEditorReturn {
	/** Current content (local state) */
	content: string;
	/** Whether there are unsaved changes */
	hasUnsavedChanges: boolean;
	/** Whether a save operation is in progress */
	isSaving: boolean;
	/** Handle content change from editor */
	handleChange: (newContent: string) => void;
	/** Manually trigger save */
	saveFile: () => Promise<void>;
	/** Reset to initial content */
	reset: () => void;
}

/**
 * Hook for managing file editing with auto-save functionality
 */
export function useFileEditor(options: UseFileEditorOptions): UseFileEditorReturn {
	const {
		filePath,
		initialContent,
		websocket,
		readOnly = false,
		onSaved,
		onError,
	} = options;

	const [content, setContent] = useState(initialContent);
	const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const lastSavedContentRef = useRef(initialContent);

	// Update content when initialContent changes externally
	useEffect(() => {
		if (initialContent !== lastSavedContentRef.current) {
			setContent(initialContent);
			lastSavedContentRef.current = initialContent;
			setHasUnsavedChanges(false);
		}
	}, [initialContent]);

	// Cleanup timeout on unmount
	useEffect(() => {
		return () => {
			if (autoSaveTimeoutRef.current) {
				clearTimeout(autoSaveTimeoutRef.current);
			}
		};
	}, []);

	const saveFile = useCallback(async () => {
		if (!websocket || readOnly || !hasUnsavedChanges) {
			return;
		}

		setIsSaving(true);

		try {
			// Send UPDATE_FILE message via WebSocket
			websocket.send(JSON.stringify({
				type: 'update_file',
				data: {
					filePath,
					content,
				}
			}));

			// Listen for response
			const handleMessage = (event: MessageEvent) => {
				try {
					const message = JSON.parse(event.data as string);

					if (message.type === 'file_updated' && message.filePath === filePath) {
						lastSavedContentRef.current = content;
						setHasUnsavedChanges(false);
						setIsSaving(false);
						toast.success('File saved successfully');
						onSaved?.(filePath);
						websocket.removeEventListener('message', handleMessage);
					} else if (message.type === 'file_update_error' && message.filePath === filePath) {
						setIsSaving(false);
						const errorMsg = message.error || 'Failed to save file';
						toast.error(errorMsg);
						onError?.(errorMsg);
						websocket.removeEventListener('message', handleMessage);
					}
				} catch (error) {
					console.error('Error parsing WebSocket message:', error);
				}
			};

			websocket.addEventListener('message', handleMessage);

			// Set timeout in case we don't get a response
			setTimeout(() => {
				if (isSaving) {
					websocket.removeEventListener('message', handleMessage);
					setIsSaving(false);
					toast.error('Save operation timed out');
					onError?.('Timeout');
				}
			}, 10000); // 10 second timeout
		} catch (error) {
			setIsSaving(false);
			const errorMsg = error instanceof Error ? error.message : 'Failed to save file';
			toast.error(errorMsg);
			onError?.(errorMsg);
		}
	}, [websocket, readOnly, hasUnsavedChanges, filePath, content, onSaved, onError, isSaving]);

	const handleChange = useCallback((newContent: string) => {
		if (readOnly) {
			return;
		}

		setContent(newContent);

		const hasChanges = newContent !== lastSavedContentRef.current;
		setHasUnsavedChanges(hasChanges);

		// Clear existing auto-save timeout
		if (autoSaveTimeoutRef.current) {
			clearTimeout(autoSaveTimeoutRef.current);
		}

		// Schedule auto-save if there are changes
		if (hasChanges && websocket) {
			autoSaveTimeoutRef.current = setTimeout(() => {
				saveFile();
			}, AUTO_SAVE_DELAY);
		}
	}, [readOnly, websocket, saveFile]);

	const reset = useCallback(() => {
		setContent(initialContent);
		lastSavedContentRef.current = initialContent;
		setHasUnsavedChanges(false);

		if (autoSaveTimeoutRef.current) {
			clearTimeout(autoSaveTimeoutRef.current);
			autoSaveTimeoutRef.current = null;
		}
	}, [initialContent]);

	return {
		content,
		hasUnsavedChanges,
		isSaving,
		handleChange,
		saveFile,
		reset,
	};
}

export { AUTO_SAVE_DELAY };
