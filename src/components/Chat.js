import React, { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import axios from "axios";
import forge from "node-forge";

// Utility function to safely convert anything to a renderable string
const safeRender = (value, fallback = "Unknown") => {
    if (value === null || value === undefined) return fallback;
    if (typeof value === "string") return value;
    if (typeof value === "object" && value.name) return value.name; // Handle { _id, name }
    return JSON.stringify(value); // Fallback for any other object
};

function Chat({ token, privateKey }) {
    const [users, setUsers] = useState([]);
    const [messages, setMessages] = useState([]);
    const [message, setMessage] = useState("");
    const [recipient, setRecipient] = useState(null);
    const [selectedGroup, setSelectedGroup] = useState(null);
    const [groups, setGroups] = useState([]);
    const [currentUserId, setCurrentUserId] = useState(null);
    const [selectedFile, setSelectedFile] = useState(null);
    const [selectedUser, setSelectedUser] = useState(null);
    const socket = useRef(null);
    const fileInputRef = useRef(null);
    const [notifications, setNotifications] = useState([]);
    const [editingGroupId, setEditingGroupId] = useState(null);

    // Log state changes
    const setRecipientWithLog = (value) => {
        console.log(`setRecipient called with: ${value}`);
        setRecipient(value);
    };

    const setSelectedGroupWithLog = (value) => {
        console.log(`setSelectedGroup called with: ${value}`);
        setSelectedGroup(value);
    };

    const Notification = ({ message, onClose }) => (
        <div style={styles.notification}>
            <div>{safeRender(message)}</div>
            <button onClick={onClose} style={styles.notificationClose}>Close</button>
        </div>
    );

    const decryptMessage = (encryptedContent, plaintextContent, isPrivate, senderId, currentUserId) => {
        if (!isPrivate || senderId === currentUserId) return safeRender(plaintextContent);
        if (!privateKey || !encryptedContent) return safeRender(encryptedContent || plaintextContent);
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

    const isGroupAdmin = (groupId) => {
        if (!groupId || !currentUserId) return false;
        const group = groups.find(g => g?._id === groupId);
        if (!group) return false;
        const creatorId = safeRender(group.creator?._id || group.creator);
        return creatorId === currentUserId.toString();
    };

    const canSendInGroup = (groupId) => {
        const group = groups.find(g => g._id === groupId);
        if (!group) return false;
        const creatorId = safeRender(group.creator?._id || group.creator);
        if (creatorId === currentUserId) return true;
        const member = group.members.find(m => safeRender(m.userId?._id || m.userId) === currentUserId);
        return member?.canSendMessages === true;
    };

    useEffect(() => {
        if (token && !socket.current) {
            socket.current = io("http://localhost:3000", {
                auth: { token },
                forceNew: true // Ensure unique connection per incognito window
            });

            socket.current.on("connect", () => console.log("Connected to server:", socket.current.id));
            socket.current.on("userId", (userId) => {
                setCurrentUserId(userId);
                socket.current.userId = userId;
                console.log("Received userId:", userId);
            });

            socket.current.on("chatMessage", (msg) => {
                console.log("Received chatMessage:", msg);
                const isPrivate = !!msg.recipient;
                const content = msg.file ? { type: 'file', ...msg.file } : decryptMessage(
                    msg.encryptedContent,
                    msg.content,
                    isPrivate,
                    safeRender(msg.sender?._id || msg.sender),
                    socket.current.userId
                );

                console.log("Current context:", { selectedGroup, recipient, currentUserId, msgGroup: msg.group, msgRecipient: msg.recipient });

                // Add all messages to state, filter in UI
                setMessages(prev => {
                    const filtered = prev.filter(m => m.tempId !== msg.tempId && m._id !== msg._id);
                    const newMessages = [...filtered, { ...msg, content }];
                    console.log("Updated messages:", newMessages);
                    return newMessages;
                });

                if (safeRender(msg.sender?._id || msg.sender) !== currentUserId) {
                    const senderName = safeRender(msg.sender?.name, "Someone");
                    const notificationText = msg.file ? `${senderName} sent a file` : `${senderName}: ${safeRender(content)}`;
                    const notificationId = Date.now();
                    setNotifications(prev => [...prev, { id: notificationId, text: notificationText }]);
                    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== notificationId)), 5000);
                }
            });

            socket.current.on("error", (error) => console.error("Socket error:", error.message));
            socket.current.on("disconnect", () => console.log("Disconnected from server"));

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
        if (socket.current && selectedGroup) {
            console.log("Joining group:", selectedGroup);
            socket.current.emit("joinGroup", selectedGroup);
            return () => {
                console.log("Leaving group:", selectedGroup);
                socket.current.emit("leaveGroup", selectedGroup);
            };
        }
    }, [selectedGroup]);

    useEffect(() => {
        if (token && (recipient || selectedGroup) && currentUserId) {
            console.log("Fetching messages for:", { recipient, selectedGroup });
            const fetchMessages = async () => {
                try {
                    const url = recipient
                        ? `http://localhost:3000/api/messages/private/${recipient}`
                        : `http://localhost:3000/api/messages/group/${selectedGroup}`;
                    const res = await axios.get(url, { headers: { Authorization: token } });
                    const processedMessages = res.data.map(msg => ({
                        ...msg,
                        content: msg.file ? { type: 'file', ...msg.file } : decryptMessage(
                            msg.encryptedContent,
                            msg.content,
                            !!msg.recipient,
                            safeRender(msg.sender?._id || msg.sender),
                            currentUserId
                        )
                    }));
                    console.log("Fetched messages:", processedMessages);
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

        if (selectedGroup && !canSendInGroup(selectedGroup)) {
            setNotifications(prev => [...prev, {
                id: Date.now(),
                text: "You don't have permission to send messages in this group"
            }]);
            return;
        }

        const tempId = Date.now().toString();
        let newMessage;

        if (selectedFile) {
            const formData = new FormData();
            formData.append('file', selectedFile);
            if (recipient) formData.append('recipient', recipient);
            if (selectedGroup) formData.append('group', selectedGroup);
            formData.append('tempId', tempId);

            try {
                const response = await axios.post("http://localhost:3000/api/upload", formData, {
                    headers: { Authorization: token, 'Content-Type': 'multipart/form-data' }
                });
                newMessage = {
                    sender: { _id: currentUserId, name: "You" },
                    content: { type: 'file', ...response.data },
                    recipient: recipient || null,
                    group: selectedGroup || null,
                    tempId,
                    timestamp: new Date()
                };
                console.log("Sending file message:", newMessage);
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
            console.log("Sending text message:", newMessage);
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
            axios.post("http://localhost:3000/api/groups", { name: groupName }, { headers: { Authorization: token } })
                .then(res => setGroups(prev => [...prev, res.data]))
                .catch(err => console.error("Error creating group:", err));
        }
    };

    const addMemberToGroup = async (groupId, userId) => {
        if (!userId || !groupId) return;
        const canSendMessages = window.confirm(`Allow ${safeRender(users.find(u => u._id === userId)?.name, userId)} to send messages?`);
        try {
            const response = await axios.put(
                `http://localhost:3000/api/groups/${groupId}/members`,
                { userId, canSendMessages },
                { headers: { Authorization: token } }
            );
            setGroups(prev => prev.map(g => g._id === groupId ? response.data : g));
        } catch (error) {
            console.error("Error adding member to group:", error);
            setNotifications(prev => [...prev, { id: Date.now(), text: "Failed to add member" }]);
        }
    };

    const updateGroupPermissions = async (groupId, userId, canSendMessages) => {
        if (!groupId || !userId) return;
        try {
            const response = await axios.put(
                `http://localhost:3000/api/groups/${groupId}/permissions`,
                { userId, canSendMessages },
                { headers: { Authorization: token } }
            );
            setGroups(prev => prev.map(g => g._id === groupId ? response.data : g));
        } catch (error) {
            console.error("Error updating permissions:", error);
            setNotifications(prev => [...prev, { id: Date.now(), text: "Failed to update permissions" }]);
        }
    };

    const showUserProfile = async (userId) => {
        try {
            const response = await axios.get(`http://localhost:3000/api/users/${userId}`, { headers: { Authorization: token } });
            setSelectedUser(response.data);
        } catch (error) {
            console.error("Error fetching user profile:", error);
        }
    };

    const closeProfile = () => setSelectedUser(null);

    const renderMessageContent = (msg) => {
        if (!msg || !msg.content) return <div>[Invalid Message]</div>;

        if (msg.content.type === 'file') {
            const { name, url, size, mimeType } = msg.content;
            const isImage = mimeType?.startsWith('image/');
            return (
                <div style={styles.fileMessage}>
                    <strong>{safeRender(msg.sender?.name)}:</strong>
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
                <strong>{safeRender(msg.sender?.name)}:</strong> {safeRender(msg.content)}
            </div>
        );
    };

    const toggleEditGroup = (groupId) => {
        setEditingGroupId(prev => prev === groupId ? null : groupId);
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
                            onClick={() => {
                                console.log("Selecting user:", user._id);
                                setRecipientWithLog(user._id);
                                setSelectedGroupWithLog(null);
                                setEditingGroupId(null);
                            }}
                            style={{ cursor: "pointer", flex: 1 }}
                        >
                            {safeRender(user.name)} - {safeRender(user.status)}
                        </span>
                        <button onClick={() => showUserProfile(user._id)} style={styles.profileButton}>
                            Profile
                        </button>
                    </div>
                ))}
                <h3>Groups</h3>
                {groups.map(grp => (
                    <div
                        key={grp._id}
                        style={{ ...styles.group, background: selectedGroup === grp._id ? "#ddd" : "transparent" }}
                    >
                        <div style={styles.groupHeader}>
                            <span
                                onClick={() => {
                                    console.log("Selecting group:", grp._id);
                                    setSelectedGroupWithLog(grp._id);
                                    setRecipientWithLog(null);
                                }}
                                style={{ cursor: "pointer", flex: 1 }}
                            >
                                {safeRender(grp.name)} {isGroupAdmin(grp._id) ? "(Admin)" : ""}
                            </span>
                            {isGroupAdmin(grp._id) && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleEditGroup(grp._id);
                                    }}
                                    style={{
                                        ...styles.editButton,
                                        background: editingGroupId === grp._id ? "#dc3545" : "#ffc107"
                                    }}
                                >
                                    {editingGroupId === grp._id ? "Close" : "Edit"}
                                </button>
                            )}
                        </div>
                        {editingGroupId === grp._id && isGroupAdmin(grp._id) && (
                            <div style={styles.groupManagement}>
                                <h4>Members</h4>
                                {grp.members.map((member, index) => (
                                    <div key={`${safeRender(member.userId?._id || member.userId)}-${index}`} style={styles.member}>
                                        <span style={{ marginRight: '10px' }}>
                                            {safeRender(users.find(u => u._id === safeRender(member.userId?._id || member.userId))?.name, member.userId)}
                                        </span>
                                        <label>
                                            <input
                                                type="checkbox"
                                                checked={member.canSendMessages || false}
                                                onChange={(e) => updateGroupPermissions(grp._id, safeRender(member.userId?._id || member.userId), e.target.checked)}
                                                disabled={safeRender(member.userId?._id || member.userId) === currentUserId}
                                            />
                                            Can Send
                                        </label>
                                    </div>
                                ))}
                                <h4>Add Member</h4>
                                <select
                                    onChange={(e) => {
                                        if (e.target.value) {
                                            addMemberToGroup(grp._id, e.target.value);
                                            e.target.value = "";
                                        }
                                    }}
                                    style={styles.addMemberSelect}
                                    defaultValue=""
                                >
                                    <option value="">Select a user</option>
                                    {users
                                        .filter(u => !grp.members.some(m => safeRender(m.userId?._id || m.userId) === u._id))
                                        .map(user => (
                                            <option key={user._id} value={user._id}>
                                                {safeRender(user.name)}
                                            </option>
                                        ))}
                                </select>
                            </div>
                        )}
                    </div>
                ))}
                <button onClick={createGroup} style={styles.button}>Create Group</button>
            </div>
            <div style={styles.chat}>
                <h3>
                    {recipient
                        ? "Private Chat"
                        : selectedGroup
                            ? `Group: ${safeRender(groups.find(g => g._id === selectedGroup)?.name)}`
                            : "Select a chat"}
                </h3>
                <div style={styles.messages}>
                    {messages
                        .filter(msg =>
                            (msg.recipient && (msg.recipient === recipient || msg.recipient === currentUserId || msg.sender._id === currentUserId)) ||
                            (msg.group && msg.group === selectedGroup)
                        )
                        .map((msg, index) => (
                            <div key={msg._id || msg.tempId || `msg-${index}`} style={styles.message}>
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
            {selectedUser && (
                <div style={styles.modalOverlay}>
                    <div style={styles.modal}>
                        <h3>User Profile</h3>
                        {selectedUser.image && (
                            <img
                                src={`http://localhost:3000${selectedUser.image}`}
                                alt={`${safeRender(selectedUser.name)}'s profile`}
                                style={styles.profileImage}
                            />
                        )}
                        <p><strong>Name:</strong> {safeRender(selectedUser.name)}</p>
                        <p><strong>Email:</strong> {safeRender(selectedUser.email)}</p>
                        <p><strong>Location:</strong> {safeRender(selectedUser.location, "Not specified")}</p>
                        <p><strong>Designation:</strong> {safeRender(selectedUser.designation, "Not specified")}</p>
                        <p><strong>Status:</strong> {safeRender(selectedUser.status)}</p>
                        <button onClick={closeProfile} style={styles.closeButton}>Close</button>
                    </div>
                </div>
            )}
            {notifications.map((notification) => (
                <Notification
                    key={notification.id}
                    message={notification.text}
                    onClose={() => setNotifications(prev => prev.filter(n => n.id !== notification.id))}
                />
            ))}
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
    user: { padding: "10px", cursor: "pointer", borderBottom: "1px solid #ccc", display: "flex", alignItems: "center", justifyContent: "space-between" },
    group: { padding: "10px", borderBottom: "1px solid #ccc" },
    groupHeader: { display: "flex", alignItems: "center", justifyContent: "space-between" },
    editButton: { padding: "5px 10px", color: "#000", border: "none", cursor: "pointer", borderRadius: "3px" },
    groupManagement: { padding: "5px", background: "#f9f9f9", marginTop: "5px" },
    member: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "5px" },
    addMemberSelect: { padding: "5px", width: "100%", marginBottom: "10px" },
    message: { padding: "5px", borderBottom: "1px solid #eee" },
    fileMessage: { margin: "5px 0" },
    fileLink: { color: "#007bff", textDecoration: "none", display: "block", marginTop: "5px" },
    previewImage: { maxWidth: "200px", maxHeight: "200px", marginTop: "5px" },
    profileButton: { padding: "5px 10px", background: "#28a745", color: "#fff", border: "none", cursor: "pointer", borderRadius: "3px" },
    modalOverlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center" },
    modal: { background: "#fff", padding: "20px", borderRadius: "5px", width: "300px", boxShadow: "0 2px 10px rgba(0,0,0,0.1)" },
    closeButton: { padding: "10px", background: "#dc3545", color: "#fff", border: "none", cursor: "pointer", width: "100%", marginTop: "10px", borderRadius: "3px" },
    profileImage: { width: "100px", height: "100px", borderRadius: "50%", marginBottom: "10px", objectFit: "cover" },
    notification: { position: 'fixed', top: '20px', right: '20px', background: '#fff', padding: '15px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.2)', marginBottom: '10px', zIndex: 1000 },
    notificationClose: { marginTop: '5px', padding: '5px 10px', background: '#ff4444', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }
};

export default Chat;