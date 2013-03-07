<?php
require_once("constants.php");
require_once("function.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("category.php");
require_once("topic.php");
include_once("header.php");

	$required_fields = array('category_id', 'topic_title');
	$errors = array();

	$categories = Category::find_all(); 
if(isset($_POST['topicId'])){


	$topicId = $_POST['topicId'];     
	$topic = Topic::find_by_id($topicId);
	echo "<div id=\"registerErrorMessages\"></div>" ;
	
	echo "<form action=\"editTopic.php\" enctype=\"multipart/form-data\" method=\"post\" id=\"editTopicForm\">";
	echo "<legend>Edit Topic</legend>";
	echo "<fieldset>";
	echo "<input type=\"hidden\" id=\"id\" name=\"id\" value=\"" . $topic->id . "\"/> </br>";
	echo "<label for=\"categories\">Category:</label>";
	echo "<select id=\"categories\" name=\"category_id\">";
		foreach($categories as $category){
			if($topic->category_id == $category->id ){
				echo "<option value=\"" . $category->id . "\" selected>" . $category->category_title . "</option></br>";
			} else {
				echo "<option value=\"" . $category->id . "\">" . $category->category_title . "</option></br>";
			}
		}
	echo "</select></br>";
	echo "<label for=\"topic_title\">Topic Title:</label>";
	echo "<input id=\"topic_title\" name=\"topic_title\" type=\"text\"  value=\"" . $topic->topic_title . "\"/></br>";
	echo "<label for=\"description\">Description:</label>";
	echo "<textarea id=\"description\" name=\"description\">" . $topic->description . "</textarea></br>";
	echo "<input id=\"topic_creator\" type=\"hidden\" name=\"topic_creator\" value=\"" . $_SESSION['user_id'] . "\"></input>";

	echo "<label for=\"video\">Select Video:</label>";
	echo "<input type=\"file\" id=\"video\" name=\"video\"/></br>";
	echo "<input type=\"hidden\" id=\"submit2\" name=\"submit\"/>";
	echo "<input id =\"editTopicSubmit\" name=\"submit\" type=\"submit\" value=\"submit\"/></br>";
	echo "</fieldset>";
	echo "</form>";



} else if (isset($_POST['submit'])){

	foreach($required_fields as $required_field){
		if(!(isset($_POST[$required_field])) || (empty($_POST[$required_field]) && is_numeric($_POST[$required_field]))){
			$error[] = $required_field . ' is a required field';
		}
	}

	if(empty($errors) && ($_FILES['video']['error'] == 0)){

		$id = mysql_real_escape_string($_POST['id']);
		$des = mysql_real_escape_string($_POST['description']);
		$cid = mysql_real_escape_string($_POST['category_id']);
		$tt = mysql_real_escape_string($_POST['topic_title']);
		$filename = $_FILES['video']['name'];
		$filetype = $_FILES['video']['type'];
		$filesize = $_FILES['video']['size'];
		$filetmpname = $_FILES['video']['tmp_name'];

		$newTopic = Topic::newTopic($cid,$des,$tt, $_SESSION['user_id'],$filename, $filesize, $filetype, $filetmpname);
		move_uploaded_file($newTopic->temp_name, "/Applications/XAMPP/xamppfiles/htdocs/ToastmasterLibrary/videos/" . $newTopic->name);		

		$newTopic->id = $id;
		if($newTopic->save()){
			// redirect_to("userRoleListing.php");
		} else {
			die("Cannot update topic. " . mysql_error());
		}
	} else {
		foreach($errors as $error){
			echo $error . '</br></br>' ;
		}
		echo '</br>' . $_FILES['video']['error'] . '</br>';
	}
}

?>

<?php
include_once("footer.php");
?>
<script>
	$('#addEditTopicsBlock').unbind();
	$('#addEditTopicsBlock').on("click","#editTopicSubmit", function(e){

		e.preventDefault();
		e.stopPropagation();

		//alert('edit topic');


		var valid = '';
		var errorDisplay = '' ;
		var required = ' is required.';
		var title = $('form[id="editTopicForm"] #topic_title').val();

		if(title == ''){
			valid += '<p> A title is required. </p>';
		}

		if(valid.length > 0){
			$('div[class="alert alert-error"]').remove();
			errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
			$("#registerErrorMessages").append(errorDisplay);
		} else {
			submitTopicEditData();
		}
	});

	function submitTopicEditData(formData){
		$('form[id="editTopicForm"]').ajaxSubmit({
			type:'POST',
			url: 'editTopic.php',
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">Success!</div>');
				$("#settingsControls").load("topicALE.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">Ajax problems.</div>');
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="uploadTopicForm"]')[0].reset();
			}
		});
	};
</script>