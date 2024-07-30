import * as core from "@actions/core";
import * as github from "@actions/github";
import * as glob from "@actions/glob";
import { readFileSync } from "fs";

interface Input {
  token: string;
  includeGitignore: boolean;
  includeGit: boolean;
  ignoreDefault: boolean;
  parseUnownedFiles: boolean;
  files: string;
}

export function getInputs(): Input {
  const result = {} as Input;
  result.token = core.getInput("github-token");
  result.includeGitignore = core.getBooleanInput("include-gitignore");
  result.includeGit = core.getBooleanInput("include-git");
  result.ignoreDefault = core.getBooleanInput("ignore-default");
  result.parseUnownedFiles = core.getBooleanInput("parse-unowned-files");
  result.files = core.getInput("files");
  return result;
}

export const runAction = async (
  _octokit: ReturnType<typeof github.getOctokit>,
  input: Input
): Promise<void> => {
  const addIgnoresToPatterns = (patterns: string) => {
    let result = patterns;
    if (!input.includeGit) {
      result += "\n!.git";
    }
    return result;
  };

  let allFiles: string[] = [];
  if (input.files) {
    allFiles = input.files.split(" ");
    allFiles = await (
      await glob.create(addIgnoresToPatterns(allFiles.join("\n")))
    ).glob();
  } else {
    allFiles = await (await glob.create(addIgnoresToPatterns("*"))).glob();
  }
  core.startGroup(`All Files: ${allFiles.length}`);
  core.info(JSON.stringify(allFiles));
  core.endGroup();

  let codeownersBuffer: string;
  try {
    codeownersBuffer = readFileSync("CODEOWNERS", "utf8");
  } catch (error) {
    try {
      codeownersBuffer = readFileSync(".github/CODEOWNERS", "utf8");
    } catch (error) {
      throw new Error("No CODEOWNERS file found");
    }
  }
  core.startGroup("CODEOWNERS File");
  core.info(codeownersBuffer);
  core.endGroup();
  let codeownersBufferFiles = codeownersBuffer
    .split("\n")
    .map((line) => line.split(" ")[0]);
  codeownersBufferFiles = codeownersBufferFiles.map((file) =>
    file.replace(/^\//, "")
  );
  const unownedFilesPatterns: string[] = input.parseUnownedFiles
    ? codeownersBufferFiles
        .filter((file) => file.startsWith("#?"))
        .map((file) => file.replace(/^#\?/, ""))
    : [];
  codeownersBufferFiles = codeownersBufferFiles.filter(
    (file) => !file.startsWith("#")
  );
  if (input.ignoreDefault === true) {
    codeownersBufferFiles = codeownersBufferFiles.filter(
      (file) => file !== "*"
    );
  }

  const codeownersGlob = await glob.create(codeownersBufferFiles.join("\n"));
  let codeownersFiles = await codeownersGlob.glob();
  core.startGroup(`CODEOWNERS Files: ${codeownersFiles.length}`);
  core.info(JSON.stringify(codeownersFiles));
  core.endGroup();
  codeownersFiles = codeownersFiles.filter((file) => allFiles.includes(file));
  core.info(`CODEOWNER Files in All Files: ${codeownersFiles.length}`);
  core.startGroup("CODEOWNERS");
  core.info(JSON.stringify(codeownersFiles));
  core.endGroup();

  let gitIgnoreFiles: string[] = [];
  try {
    const gitIgnoreBuffer = readFileSync(".gitignore", "utf8");
    const gitIgnoreGlob = await glob.create(gitIgnoreBuffer);
    gitIgnoreFiles = await gitIgnoreGlob.glob();
    core.info(`.gitignore Files: ${gitIgnoreFiles.length}`);
  } catch (error) {
    core.info("No .gitignore file found");
  }

  const unownedFilesGlob = await glob.create(unownedFilesPatterns.join("\n"));
  const unownedFiles: string[] = await unownedFilesGlob.glob();
  if (input.parseUnownedFiles) {
    core.info(`Unowned Files: ${unownedFiles.length}`);
  }

  let filesCovered = codeownersFiles;
  let allFilesClean = allFiles;
  if (input.includeGitignore === true) {
    allFilesClean = allFiles.filter((file) => !gitIgnoreFiles.includes(file));
    filesCovered = filesCovered.filter(
      (file) => !gitIgnoreFiles.includes(file)
    );
  }
  if (unownedFiles.length) {
    allFilesClean = allFilesClean.filter(
      (file) => !unownedFiles.includes(file)
    );
    filesCovered = filesCovered.filter((file) => !unownedFiles.includes(file));
  }
  if (input.files) {
    filesCovered = filesCovered.filter((file) => allFilesClean.includes(file));
  }
  const coveragePercent = (filesCovered.length / allFilesClean.length) * 100;
  const coverageMessage = `${filesCovered.length}/${
    allFilesClean.length
  }(${coveragePercent.toFixed(2)}%) files covered by CODEOWNERS`;
  core.notice(coverageMessage, {
    title: "Coverage",
    file: "CODEOWNERS",
  });

  const filesNotCovered = allFilesClean.filter(
    (f) => !filesCovered.includes(f)
  );

  for (const file of filesNotCovered) {
    core.error("File not covered by CODEOWNERS: " + file, {
      title: "CODEOWNERS coverage",
      file,
    });
  }

  if (filesNotCovered.length > 0) {
    core.setFailed(`${filesNotCovered.length} files not covered by CODEOWNERS`);
  }
};

const run = async (): Promise<void> => {
  try {
    const input = getInputs();
    const octokit: ReturnType<typeof github.getOctokit> = github.getOctokit(
      input.token
    );
    return runAction(octokit, input);
  } catch (error) {
    core.startGroup(
      error instanceof Error ? error.message : JSON.stringify(error)
    );
    core.info(JSON.stringify(error, null, 2));
    core.endGroup();
  }
};

export default run;
