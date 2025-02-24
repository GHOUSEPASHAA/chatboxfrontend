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
    const socket = useRef(null);

    const decryptMessage = (encryptedContent, plaintextContent, isPrivate, senderId, currentUserId) => {
        if (!isPrivate) {
            console.log('Group message, using plaintext:', plaintextContent);
            return plaintextContent;
        }

        if (senderId === currentUserId) {
            console.log('Sender’s message, using plaintext:', plaintextContent);
            return plaintextContent; // Sender sees their own plaintext
        }

        if (!privateKey || !encryptedContent) {
            console.log('No decryption possible:', encryptedContent);
            return encryptedContent || plaintextContent;
        }

        console.log('Decrypting recipient message:', encryptedContent);
        try {
            const privateKeyObj = forge.pki.privateKeyFromPem(privateKey);
            const encryptedBytes = forge.util.decode64(encryptedContent);
            const decrypted = privateKeyObj.decrypt(encryptedBytes, 'RSA-OAEP');
            const result = forge.util.decodeUtf8(decrypted);
            console.log('Decrypted content:', result);
            return result;
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
                console.log('Current user ID from server:', userId);
                setCurrentUserId(userId);
                socket.current.userId = userId;
            });

            socket.current.on("chatMessage", (msg) => {
                const isPrivate = !!msg.recipient;
                console.log('Received real-time message:', JSON.stringify(msg));
                const content = decryptMessage(
                    msg.encryptedContent,
                    msg.content, // Server sends 'content' as either plaintext or encrypted
                    isPrivate,
                    msg.sender._id || msg.sender,
                    socket.current.userId
                );

                setMessages(prev => {
                    // Deduplicate using tempId or _id
                    const filtered = prev.filter(m => m.tempId !== msg.tempId && m._id !== msg._id);
                    return [...filtered, { ...msg, content }];
                });
            });

            socket.current.on("statusUpdate", ({ userId, status }) => {
                setUsers(prev => prev.map(user => user._id === userId ? { ...user, status } : user));
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
                    console.log('Fetched messages:', JSON.stringify(res.data));
                    const decryptedMessages = res.data.map(msg => ({
                        ...msg,
                        content: decryptMessage(
                            msg.encryptedContent,
                            msg.content, // Use content from API response
                            !!msg.recipient,
                            msg.sender._id || msg.sender,
                            currentUserId
                        ),
                    }));
                    setMessages(decryptedMessages);
                } catch (error) {
                    console.error("Error fetching messages:", error);
                }
            };
            fetchMessages();
        }
    }, [recipient, selectedGroup, token, privateKey, currentUserId]);

    const sendMessage = () => {
        if (message.trim() && socket.current) {
            console.log('Sending message:', { recipient, group: selectedGroup, content: message });
            const tempId = Date.now().toString();
            const newMessage = {
                sender: { _id: currentUserId, name: "You" },
                content: message,
                recipient: recipient || null,
                group: selectedGroup || null,
                tempId,
            };

            // Add locally with tempId for optimistic UI update
            setMessages(prev => [...prev, newMessage]);
            socket.current.emit("chatMessage", { recipient, group: selectedGroup, content: message, tempId });
            setMessage("");
        }
    };

    const createGroup = () => {
        const groupName = prompt("Enter group name:");
        if (groupName) {
            axios.post("http://localhost:3000/api/groups", { name: groupName }, { headers: { Authorization: token } })
                .then(res => setGroups([...groups, res.data]))
                .catch(err => console.error("Error creating group:", err));
        }
    };

    return (
        <div style={styles.container}>
            <div style={styles.sidebar}>
                <h3>Users</h3>
                {users.map(user => (
                    <div
                        key={user._id}
                        style={{ ...styles.user, background: recipient === user._id ? "#ddd" : "transparent" }}
                        onClick={() => { setRecipient(user._id); setSelectedGroup(null); }}
                    >
                        {user.name} - {user.status}
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
                            <strong>{msg.sender?.name || "Unknown"}:</strong> {msg.content}
                        </div>
                    ))}
                </div>
                <input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Type a message..."
                    style={styles.input}
                />
                <button onClick={sendMessage} style={styles.button}>Send</button>
            </div>
        </div>
    );
}

const styles = {
    container: { display: "flex", height: "100vh", fontFamily: "Arial, sans-serif" },
    sidebar: { width: "25%", padding: "10px", background: "#f0f0f0", overflowY: "auto" },
    chat: { flex: 1, padding: "10px", display: "flex", flexDirection: "column" },
    messages: { flex: 1, overflowY: "auto", border: "1px solid #ccc", padding: "10px", marginBottom: "10px" },
    input: { padding: "10px", marginBottom: "10px", width: "100%" },
    button: { padding: "10px", cursor: "pointer", background: "#007bff", color: "#fff", border: "none" },
    user: { padding: "10px", cursor: "pointer", borderBottom: "1px solid #ccc" },
    group: { padding: "10px", cursor: "pointer", borderBottom: "1px solid #ccc" },
    message: { padding: "5px", borderBottom: "1px solid #eee" },
};

export default Chat;