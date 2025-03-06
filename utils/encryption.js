// utils/encryption.js - Client-side encryption utilities

import { SignalProtocolManager } from './signalProtocol';
import { socket } from './socket';

let signalManager = null;
const pendingMessages = new Map();

/**
 * Initialize the encryption system
 * @param {string} userId Current user ID
 * @returns {Promise<void>}
 */
export const initializeEncryption = async (userId) => {
  signalManager = new SignalProtocolManager(userId);
  await signalManager.initializeIdentity();
  
  // Register public keys with the server
  const publicKeys = await signalManager.getPublicKeys();
  await registerPublicKeys(publicKeys);
  
  // Set up event listeners for key exchanges
  socket.on('new-pre-key-bundle', async (data) => {
    await signalManager.processPreKeyBundle(data.userId, data.bundle);
  });
  
  socket.on('encrypted-message', async (data) => {
    const { senderId, channelId, encryptedMessage, messageId } = data;
    
    try {
      const decryptedContent = await signalManager.decryptMessage(senderId, encryptedMessage);
      
      // Emit an event with the decrypted message
      const decryptEvent = new CustomEvent('message-decrypted', {
        detail: {
          messageId,
          senderId,
          channelId,
          content: JSON.parse(decryptedContent)
        }
      });
      window.dispatchEvent(decryptEvent);
      
      // Acknowledge decryption
      socket.emit('message-decrypted', { messageId });
    } catch (error) {
      console.error('Error decrypting message:', error);
      // Request a new pre-key bundle if decryption fails
      socket.emit('request-pre-key-bundle', { userId: senderId });
    }
  });
};

/**
 * Register public keys with the server
 * @param {Object} publicKeys Public key bundle
 * @returns {Promise<void>}
 */
const registerPublicKeys = async (publicKeys) => {
  return new Promise((resolve, reject) => {
    socket.emit('register-public-keys', publicKeys, (response) => {
      if (response.success) {
        resolve();
      } else {
        reject(new Error(response.error));
      }
    });
  });
};

/**
 * Encrypt a message for a specific user
 * @param {string} recipientId Recipient user ID
 * @param {Object} content Message content
 * @returns {Promise<Object>} Encrypted message
 */
export const encryptMessage = async (recipientId, content) => {
  if (!signalManager) {
    throw new Error('Encryption not initialized');
  }
  
  try {
    const contentString = JSON.stringify(content);
    const encryptedMessage = await signalManager.encryptMessage(recipientId, contentString);
    return encryptedMessage;
  } catch (error) {
    // If we don't have a session with this user yet, request their pre-key bundle
    if (error.message.includes('No session')) {
      return new Promise((resolve, reject) => {
        const requestId = `${recipientId}-${Date.now()}`;
        
        // Store the pending message
        pendingMessages.set(requestId, {
          recipientId,
          content,
          resolve,
          reject
        });
        
        // Request pre-key bundle from server
        socket.emit('request-pre-key-bundle', { userId: recipientId, requestId });
        
        // Set up one-time listener for the pre-key bundle response
        socket.once(`pre-key-bundle-${requestId}`, async (data) => {
          try {
            // Process the pre-key bundle to establish a session
            await signalManager.processPreKeyBundle(recipientId, data.bundle);
            
            // Get the pending message
            const pendingMessage = pendingMessages.get(requestId);
            if (pendingMessage) {
              // Encrypt the message now that we have a session
              const contentString = JSON.stringify(pendingMessage.content);
              const encryptedMessage = await signalManager.encryptMessage(recipientId, contentString);
              
              // Resolve the promise with the encrypted message
              pendingMessage.resolve(encryptedMessage);
              pendingMessages.delete(requestId);
            }
          } catch (error) {
            const pendingMessage = pendingMessages.get(requestId);
            if (pendingMessage) {
              pendingMessage.reject(error);
              pendingMessages.delete(requestId);
            }
          }
        });
        
        // Set a timeout in case we don't get a response
        setTimeout(() => {
          const pendingMessage = pendingMessages.get(requestId);
          if (pendingMessage) {
            pendingMessage.reject(new Error('Timeout requesting pre-key bundle'));
            pendingMessages.delete(requestId);
          }
        }, 10000);
      });
    }
    
    throw error;
  }
};

/**
 * Encrypt a file for secure transmission
 * @param {File} file The file to encrypt
 * @param {string} channelId The channel ID
 * @returns {Promise<Object>} Encrypted file data
 */
export const encryptFile = async (file, channelId) => {
  // Generate a random key for file encryption
  const key = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  
  // Export the key so we can encrypt it for each recipient
  const exportedKey = await window.crypto.subtle.exportKey('raw', key);
  
  // Read the file as ArrayBuffer
  const fileBuffer = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsArrayBuffer(file);
  });
  
  // Generate a random IV
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  // Encrypt the file
  const encryptedFile = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    fileBuffer
  );
  
  // Return the encrypted file and metadata
  return {
    encryptedFile: new Blob([encryptedFile], { type: 'application/octet-stream' }),
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
    key: new Uint8Array(exportedKey),
    iv: iv,
    channelId
  };
};

/**
 * Decrypt a received file
 * @param {Object} fileData The encrypted file data
 * @param {Uint8Array} decryptedKey The decrypted file key
 * @returns {Promise<Blob>} The decrypted file
 */
export const decryptFile = async (fileData, decryptedKey) => {
  // Import the key
  const key = await window.crypto.subtle.importKey(
    'raw',
    decryptedKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  
  // Get the file data as ArrayBuffer
  const encryptedBuffer = await fileData.encryptedFile.arrayBuffer();
  
  // Decrypt the file
  const decryptedBuffer = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fileData.iv },
    key,
    encryptedBuffer
  );
  
  // Return as Blob with the original type
  return new Blob([decryptedBuffer], { type: fileData.fileType });
};
