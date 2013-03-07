<?php
require_once("database.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("category.php");
include_once("header.php");

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}
if(isset($_POST['categoryid'])){
	$category_id = $_POST['categoryid'];     
	$result = Category::delete_by_id($category_id);

	if($result == null){

		die("Could not delete category. " . mysql_error()) ;
	} else {
		redirect_to('settings.php');
	}
}
?>