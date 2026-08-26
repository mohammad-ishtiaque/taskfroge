export const defaultSchemaOptions = {
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc: any, ret: any) => {
      if (ret._id) {
        ret.id = ret._id.toString();
        delete ret._id;
      }
      delete ret.__v;
      return ret;
    },
  },
  toObject: {
    virtuals: true,
    versionKey: false,
    transform: (_doc: any, ret: any) => {
      if (ret._id) {
        ret.id = ret._id.toString();
        delete ret._id;
      }
      delete ret.__v;
      return ret;
    },
  },
};

export * from './types';
