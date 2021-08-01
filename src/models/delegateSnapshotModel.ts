import { model, Schema, Document } from 'mongoose';

const DelegateSnapshot = new Schema(
  {
    delegate: {
        type: String,
        required: true,
    },
    space: { 
        type: String,
        required: true, 
    },
  },

);

export default model<Document>('DelegateSnapshot', DelegateSnapshot);