<?php
require_once("DatabaseObject.php");
require_once("database.php");
require_once("constants.php");
require_once("user.php");
require_once("function.php");
require_once("Session.php");
require_once("video.php");
include_once("header.php");

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
} else if(isset($_POST['submit'])){

	//check error code. if none, proceed with the video upload
	if($_FILES['video']['error'] == 0){ 
		$filename = $_FILES['video']['name'];
		$filetype = $_FILES['video']['type'];
		$filesize = $_FILES['video']['size'];
		$filetmpname = $_FILES['video']['tmp_name'];

		$video = video::loadVideo($filename, $filesize, $filetype, $filetmpname);
		echo($video->temp_name);
		echo('</br');
		echo('</br');
		echo('</br');
		echo("/Applications/XAMPP/xamppfiles/htdocs/ToastmasterLibrary/upload" . $video->name);
		move_uploaded_file($video->temp_name, "/Applications/XAMPP/xamppfiles/htdocs/ToastmasterLibrary/videos/" . $video->name);
		if($video->save()){
			redirect_to("settings.php");
		} else {
			die("Cannot upload video. " . mysql_error());
		}


	} else {
		echo($_FILES['video']['error']);
		die("Error uploading video. " . mysql_error());
	}
} else {
	//display the upload form
}
?>


<form method="post" enctype="multipart/form-data" action="uploadVideo.php">
	<legend>Video Upload:</legend>
	Select Video:<input type="file" id="video" name="video"/></br>
				 <input id="submit" name="submit" type="submit"/></br>
</form>


<?php
include_once('footer.php');
?>