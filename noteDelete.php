<?php
require_once("database.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("notes.php");
include_once("header.php");

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}
if(isset($_POST['noteid'])){
	$note_id = $_POST['noteid'];     
	$result = Note::delete_by_id($note_id);

	if($result == null){

		die("Could not delete note. " . mysql_error()) ;
	} else {
		redirect_to('settings.php');
	}
}
?>