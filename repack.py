import subprocess
import os
import sys
import re
import shutil 

def parse_book_info(title):
  """
  Parses a book title string and returns a dictionary with title, author, and narrator.

  Args:
    title: The book title string.

  Returns:
    A dictionary with keys "title", "author", and "narrator", containing the extracted information.
  """

  # Regular expressions for extracting title, author, and narrator
  title_regex = r"^(.*)- Writ"
  author_regex = r"ten by (.*) -"
  narrator_regex = r" Narrated by (.*)$"

  # Extract information using regex
  match = re.match(f"{title_regex}{author_regex}{narrator_regex}$", title)

  # Check if any information was found
  if not match:
    raise ValueError(f"Could not parse book information from title: '{title}'")

  # Extract and return information
  title = match.group(1).strip()
  author = match.group(2) if match.group(2) else None
  narrator = match.group(3) if match.group(3) else None

  return {"title": title, "author": author, "narrator": narrator}


title =""
def update_title_with_album(filepath):
  """
  Updates a the metadata by replacing the remaining content after "title=" with the value
  of another line starting with "album=" while keeping the "title=" prefix and newline.

  Args:
    filepath: The path to the file to modify.

  Raises:
    FileNotFoundError: If the file cannot be found.
    ValueError: If either "title=" or "album=" lines are not found.
  """

  with open(filepath, "r") as file:
    lines = file.readlines()

  # Find the line indexes
  title_line_index = None
  album_line_index = None
  for i, line in enumerate(lines):
    if line.startswith("title="):
      title_line_index = i
    elif line.startswith("album="):
      album_line_index = i

  # Check if both lines were found
  if title_line_index is None or album_line_index is None:
    print(f"File '{filepath}' does not contain both required lines ('title=' and 'album=')")
    folderMeta = parse_book_info(title)
    lines.append(f"title={folderMeta['title']}\n")
    lines.append(f"author={folderMeta['author']}\n")
    lines.append(f"artist={folderMeta['author']}; {folderMeta['narrator']}\n")
    lines.append(f"album_artist=Narrated by {folderMeta['narrator']}\n")
  else:
    # Extract the title and album values
    album_value = lines[album_line_index][len("album="):]
    # Update the title line
    new_title_line = f"title={album_value}"
    # Replace the old title line with the updated one
    lines[title_line_index] = new_title_line

  # Save the changes to the file
  with open(filepath, "w") as file:
    file.writelines(lines)

def get_chapter_title(filepath):
  command = f'ffprobe -show_entries format_tags="title" -v quiet {filepath}'
  out = subprocess.run(command, shell=False, capture_output=True,cwd=os.getcwd())
  out = out.stdout.decode().splitlines()
  title_regex = r"^TAG:title=(.*)$"
  for i, line in enumerate(out):
    match = re.match(title_regex, line)
    if match:
      title = match.group(1)
      break
  if not match:
    title = filepath[filepath.rfind(start:='- ')+len(start):filepath.find('.m4a')]
      
  return title

def make_chapters_metadata(list_audio_files: list, metadatafile):
    print(f"Making metadata source file")

    chapters = {}
    count = 1
    for single_audio_files in list_audio_files:
        file_path = f'"{folder}\{single_audio_files}"'
        command = f'ffprobe -v quiet -of csv=p=0 -show_entries format=duration {file_path}'
        out = subprocess.run(command, shell=False, capture_output=True,cwd=os.getcwd())
        duration_in_microseconds = int((out.stdout.decode().strip().replace(".", "")))
        title = get_chapter_title(file_path)
        chapters[f"{count:04d}"] = {"duration": duration_in_microseconds, "title": title}
        count = count+1

    chapters["0001"]["start"] = 0
    for n in range(1, len(chapters)):
        chapter = f"{n:04d}"
        next_chapter = f"{n + 1:04d}"
        chapters[chapter]["end"] = chapters[chapter]["start"] + chapters[chapter]["duration"]
        chapters[next_chapter]["start"] = chapters[chapter]["end"] + 1
    last_chapter = f"{len(chapters):04d}"
    chapters[last_chapter]["end"] = chapters[last_chapter]["start"] + chapters[last_chapter]["duration"]

    # Get metadata template from first chapter
    first_file = os.path.join(folder,list_audio_files[0])
    command = f'ffmpeg -y -loglevel error -i "{first_file}" -f ffmetadata "{metadatafile}"'
    subprocess.run(command, shell=False, capture_output=True,cwd=os.getcwd())
    

    update_title_with_album(metadatafile)

    with open(metadatafile, "a+") as m:
        for chapter in chapters:
            ch_meta = """
[CHAPTER]
TIMEBASE=1/1000000
START={}
END={}
title={}
""".format(chapters[chapter]["start"], chapters[chapter]["end"], chapters[chapter]["title"])
            m.writelines(ch_meta)
            print(ch_meta)


def concatenate_all_to_one_with_chapters(metadatafile, list_audio_files):
    filename = f'{title}.m4a'
    print(f"Concatenating chapters to {filename}")
    cover = os.path.join(folder,"cover.jpg")
    temp_file =  os.path.join(folder,"i.m4a")
    os.system(f'ffmpeg -hide_banner -y -f concat -safe 0 -i "{list_audio_files}" -i "{metadatafile}" -map_metadata 1 "{temp_file}"')
    os.system(f'ffmpeg -i "{temp_file}" -i "{cover}" -c copy -disposition:v attached_pic "{filename}"')

    os.remove(temp_file)

if __name__ == '__main__':

    print(sys.argv)

    folder = sys.argv[1].replace('"','') 
    title = os.path.split(folder)[-1].replace('"','')
    print(title)

    list_audio_files = [f for f in os.listdir(folder) if f.find(".m4a")>=0]
    list_audio_files.sort()

    metadatafile = os.path.join(folder,"combined.metadata.txt")
    listfile = os.path.join(folder,"list_audio_files.txt")

    make_chapters_metadata(list_audio_files,metadatafile)

    if os.path.isfile(listfile):
        os.remove(listfile)
    i = 0
    for filename_audio_files in list_audio_files:
        with open(listfile, "a") as f:
            filepathOld = os.path.join(folder,filename_audio_files)
            filepathNew = os.path.join(folder,f'{i}.tmp')
            i+=1
            shutil.copyfile(filepathOld,filepathNew)
            line = f"file '{filepathNew}'\n"
            f.write(line)

    concatenate_all_to_one_with_chapters(metadatafile, listfile)

    i = 0
    for filename_audio_files in list_audio_files:
       filepathNew = os.path.join(folder,f'{i}.tmp')
       i+=1
       os.remove(filepathNew)
    os.remove(metadatafile)
    os.remove(list_audio_files)