declare module "qrcode" {
  const encoder: {
    toString(
      value: string,
      options: {
        type: "svg";
        width: number;
        margin: number;
        errorCorrectionLevel: string;
      },
    ): Promise<string>;
  };
  export default encoder;
}
