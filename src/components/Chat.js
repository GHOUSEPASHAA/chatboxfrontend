import React, { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import axios from "axios";
import forge from "node-forge";

function Chat({ token, privateKey }) {
    const [users, setUsers] = useState([]);
    const [messages, setMessages] = useState([]);
    const [message, setMessage] = useState("");
    const [recipient, setRecipient] = useState(null);
    const [selectedGroup, setSelectedGroup] = useState(null);
    const [groups, setGroups] = useState([]);
    const [currentUserId, setCurrentUserId] = useState(null);
    const [selectedFile, setSelectedFile] = useState(null);
    const [selectedUser, setSelectedUser] = useState(null); // For profile display
    const socket = useRef(null);
    const fileInputRef = useRef(null);

    const decryptMessage = (encryptedContent, plaintextContent, isPrivate, senderId, currentUserId) => {
        if (!isPrivate) return plaintextContent;
        if (senderId === currentUserId) return plaintextContent;
        if (!privateKey || !encryptedContent) return encryptedContent || plaintextContent;

        try {
            const privateKeyObj = forge.pki.privateKeyFromPem(privateKey);
            const encryptedBytes = forge.util.decode64(encryptedContent);
            const decrypted = privateKeyObj.decrypt(encryptedBytes, 'RSA-OAEP');
            return forge.util.decodeUtf8(decrypted);
        } catch (error) {
            console.error("Decryption error:", error.message);
            return "[Decryption Failed]";
        }
    };

    useEffect(() => {
        if (token && !socket.current) {
            socket.current = io("http://localhost:3000", {
                auth: { token },
            });

            socket.current.on("connect", () => {
                console.log("Connected to server");
            });

            socket.current.on("userId", (userId) => {
                setCurrentUserId(userId);
                socket.current.userId = userId;
            });

            socket.current.on("chatMessage", (msg) => {
                const isPrivate = !!msg.recipient;
                let content;

                if (msg.file) {
                    content = { type: 'file', ...msg.file };
                } else {
                    content = decryptMessage(
                        msg.encryptedContent,
                        msg.content,
                        isPrivate,
                        msg.sender._id || msg.sender,
                        socket.current.userId
                    );
                }

                setMessages(prev => {
                    const filtered = prev.filter(m => m.tempId !== msg.tempId && m._id !== msg._id);
                    return [...filtered, { ...msg, content }];
                });
            });

            socket.current.on("statusUpdate", ({ userId, status }) => {
                setUsers(prev => prev.map(user =>
                    user._id === userId ? { ...user, status } : user
                ));
            });

            socket.current.on("error", (error) => {
                console.error("Socket error:", error.message);
            });

            axios.get("http://localhost:3000/api/users", { headers: { Authorization: token } })
                .then(res => setUsers(res.data))
                .catch(err => console.error("Error fetching users:", err));

            axios.get("http://localhost:3000/api/groups", { headers: { Authorization: token } })
                .then(res => setGroups(res.data))
                .catch(err => console.error("Error fetching groups:", err));
        }

        return () => {
            if (socket.current) {
                socket.current.disconnect();
                socket.current = null;
            }
        };
    }, [token, privateKey]);

    useEffect(() => {
        if (token && (recipient || selectedGroup) && currentUserId) {
            const fetchMessages = async () => {
                try {
                    const url = recipient
                        ? `http://localhost:3000/api/messages/private/${recipient}`
                        : `http://localhost:3000/api/messages/group/${selectedGroup}`;
                    const res = await axios.get(url, { headers: { Authorization: token } });

                    const processedMessages = res.data.map(msg => {
                        if (msg.file) {
                            return { ...msg, content: { type: 'file', ...msg.file } };
                        }
                        return {
                            ...msg,
                            content: decryptMessage(
                                msg.encryptedContent,
                                msg.content,
                                !!msg.recipient,
                                msg.sender._id || msg.sender,
                                currentUserId
                            ),
                        };
                    });
                    setMessages(processedMessages);
                } catch (error) {
                    console.error("Error fetching messages:", error);
                }
            };
            fetchMessages();
        }
    }, [recipient, selectedGroup, token, privateKey, currentUserId]);

    const handleFileChange = (event) => {
        const file = event.target.files[0];
        if (file) {
            setSelectedFile(file);
            setMessage(`Uploading: ${file.name}`);
        }
    };

    const sendMessage = async () => {
        if (!socket.current || (!message.trim() && !selectedFile)) return;

        const tempId = Date.now().toString();
        let newMessage;

        if (selectedFile) {
            const formData = new FormData();
            formData.append('file', selectedFile);
            if (recipient) formData.append('recipient', recipient);
            if (selectedGroup) formData.append('group', selectedGroup);
            formData.append('tempId', tempId);

            try {
                const response = await axios.post(
                    'http://localhost:3000/api/upload',
                    formData,
                    {
                        headers: {
                            Authorization: token,
                            'Content-Type': 'multipart/form-data'
                        }
                    }
                );

                newMessage = {
                    sender: { _id: currentUserId, name: "You" },
                    content: { type: 'file', ...response.data },
                    recipient: recipient || null,
                    group: selectedGroup || null,
                    tempId,
                    timestamp: new Date()
                };

                socket.current.emit("chatMessage", {
                    recipient,
                    group: selectedGroup,
                    file: response.data,
                    tempId
                });
            } catch (error) {
                console.error('File upload failed:', error);
                return;
            }
        } else {
            newMessage = {
                sender: { _id: currentUserId, name: "You" },
                content: message,
                recipient: recipient || null,
                group: selectedGroup || null,
                tempId,
                timestamp: new Date()
            };
            socket.current.emit("chatMessage", {
                recipient,
                group: selectedGroup,
                content: message,
                tempId
            });
        }

        setMessages(prev => [...prev, newMessage]);
        setMessage("");
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const createGroup = () => {
        const groupName = prompt("Enter group name:");
        if (groupName) {
            axios.post("http://localhost:3000/api/groups",
                { name: groupName },
                { headers: { Authorization: token } }
            )
                .then(res => setGroups([...groups, res.data]))
                .catch(err => console.error("Error creating group:", err));
        }
    };

    // Fetch and show user profile
    const showUserProfile = async (userId) => {
        try {
            const response = await axios.get(`http://localhost:3000/api/users/${userId}`, {
                headers: { Authorization: token }
            });
            setSelectedUser(response.data);
        } catch (error) {
            console.error("Error fetching user profile:", error);
        }
    };

    const closeProfile = () => {
        setSelectedUser(null);
    };

    const renderMessageContent = (msg) => {
        if (msg.content && msg.content.type === 'file') {
            const { name, url, size, mimeType } = msg.content;
            const isImage = mimeType.startsWith('image/');

            return (
                <div style={styles.fileMessage}>
                    <strong>{msg.sender?.name || "Unknown"}:</strong>
                    {isImage ? (
                        <div>
                            <img src={url} alt={name} style={styles.previewImage} />
                            <a href={url} download={name} style={styles.fileLink}>
                                📎 {name} ({(size / 1024).toFixed(2)} KB)
                            </a>
                        </div>
                    ) : (
                        <a href={url} download={name} style={styles.fileLink}>
                            📎 {name} ({(size / 1024).toFixed(2)} KB)
                        </a>
                    )}
                </div>
            );
        }
        return (
            <div>
                <strong>{msg.sender?.name || "Unknown"}:</strong> {msg.content}
            </div>
        );
    };

    return (
        <div style={styles.container}>
            <div style={styles.sidebar}>
                <h3>Users</h3>
                {users.map(user => (
                    <div
                        key={user._id}
                        style={{ ...styles.user, background: recipient === user._id ? "#ddd" : "transparent" }}
                    >
                        <span
                            onClick={() => { setRecipient(user._id); setSelectedGroup(null); }}
                            style={{ cursor: "pointer", flex: 1 }}
                        >
                            {user.name} - {user.status}
                        </span>
                        <button
                            onClick={() => showUserProfile(user._id)}
                            style={styles.profileButton}
                        >
                            Profile
                        </button>
                    </div>
                ))}
                <h3>Groups</h3>
                {groups.map(grp => (
                    <div
                        key={grp._id}
                        style={{ ...styles.group, background: selectedGroup === grp._id ? "#ddd" : "transparent" }}
                        onClick={() => { setSelectedGroup(grp._id); setRecipient(null); }}
                    >
                        {grp.name}
                    </div>
                ))}
                <button onClick={createGroup} style={styles.button}>Create Group</button>
            </div>
            <div style={styles.chat}>
                <h3>
                    {recipient
                        ? "Private Chat"
                        : selectedGroup
                            ? `Group: ${groups.find(g => g._id === selectedGroup)?.name || selectedGroup}`
                            : "Select a chat"}
                </h3>
                <div style={styles.messages}>
                    {messages.map((msg, i) => (
                        <div key={msg._id || msg.tempId || i} style={styles.message}>
                            {renderMessageContent(msg)}
                        </div>
                    ))}
                </div>
                <div style={styles.inputContainer}>
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        style={styles.fileInput}
                    />
                    <input
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Type a message or select a file..."
                        style={{ ...styles.input, flex: 1 }}
                        disabled={selectedFile !== null}
                    />
                    <button onClick={sendMessage} style={styles.button}>Send</button>
                </div>
            </div>

            {/* Profile Modal */}
            {selectedUser && (
                <div style={styles.modalOverlay}>
                    <div style={styles.modal}>
                        <h3>User Profile</h3>
                        {selectedUser.image && (
                            <img
                                src={`http://localhost:3000${selectedUser.image}`}
                                alt={`${selectedUser.name}'s profile`}
                                style={styles.profileImage}
                            />
                        )}
                        <p><strong>Name:</strong> {selectedUser.name}</p>
                        <p><strong>Email:</strong> {selectedUser.email}</p>
                        <p><strong>Location:</strong> {selectedUser.location || 'Not specified'}</p>
                        <p><strong>Designation:</strong> {selectedUser.designation || 'Not specified'}</p>
                        <p><strong>Status:</strong> {selectedUser.status}</p>
                        <button onClick={closeProfile} style={styles.closeButton}>Close</button>
                    </div>
                </div>
            )}
        </div>
    );
}

const styles = {
    container: { display: "flex", height: "100vh", fontFamily: "Arial, sans-serif" },
    sidebar: { width: "25%", padding: "10px", background: "#f0f0f0", overflowY: "auto" },
    chat: { flex: 1, padding: "10px", display: "flex", flexDirection: "column" },
    messages: { flex: 1, overflowY: "auto", border: "1px solid #ccc", padding: "10px", marginBottom: "10px" },
    inputContainer: { display: "flex", gap: "10px", alignItems: "center" },
    input: { padding: "10px", marginBottom: "10px" },
    fileInput: { padding: "5px" },
    button: { padding: "10px", cursor: "pointer", background: "#007bff", color: "#fff", border: "none" },
    user: {
        padding: "10px",
        cursor: "pointer",
        borderBottom: "1px solid #ccc",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between"
    },
    group: { padding: "10px", cursor: "pointer", borderBottom: "1px solid #ccc" },
    message: { padding: "5px", borderBottom: "1px solid #eee" },
    fileMessage: { margin: "5px 0" },
    fileLink: { color: "#007bff", textDecoration: "none", display: "block", marginTop: "5px" },
    previewImage: { maxWidth: "200px", maxHeight: "200px", marginTop: "5px" },
    profileButton: {
        padding: "5px 10px",
        background: "#28a745",
        color: "#fff",
        border: "none",
        cursor: "pointer",
        borderRadius: "3px"
    },
    modalOverlay: {
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center"
    },
    modal: {
        background: "#fff",
        padding: "20px",
        borderRadius: "5px",
        width: "300px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.1)"
    },
    closeButton: {
        padding: "10px",
        background: "#dc3545",
        color: "#fff",
        border: "none",
        cursor: "pointer",
        width: "100%",
        marginTop: "10px",
        borderRadius: "3px"
    },
    profileImage: {
        width: "100px",
        height: "100px",
        borderRadius: "50%",
        marginBottom: "10px",
        objectFit: "cover"
    }
};

export default Chat;