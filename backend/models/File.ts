import mongoose from 'mongoose';

// File Schema
const fileSchema = new mongoose.Schema({
    filename: { type: String, required: true, unique: true },
    content: { type: String, required: true },
    lastModified: { type: Date, default: Date.now },
    language: { type: String, default: 'java' }
});

// Version Schema
const versionSchema = new mongoose.Schema({
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File' },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    version: { type: Number, required: true }
});

export const File = mongoose.model('File', fileSchema);
export const Version = mongoose.model('Version', versionSchema); 